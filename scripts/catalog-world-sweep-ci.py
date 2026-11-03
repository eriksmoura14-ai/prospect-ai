"""Finite public-data runner, independent of the interactive machine's network.

Uses the existing public November coverage export, verified by full SHA-256.
Never accepts a database credential or touches production/user accounts.
"""
import argparse
import hashlib
import json
import subprocess
import sys
import time
import zipfile
from pathlib import Path

import requests

BASELINE_URL = 'https://br-frosty-voice-b55arvzl.storage.c-7.us-east-2.aws.neon.tech/prospect-public-catalog/archives/20261101/coverage-resume-v1.zip'
BASELINE_SHA = '73f3cd7c71ae4353790cca9c375089c497504ecdd632732a347c8a313f13c032'
BASELINE_ENTRY = '.artifacts/coverage-resume-20261101/final/all-city-coverage.csv'
SEED = 'data/catalog-world-evidence-seed-20261102.ndjson.gz'
SEED_SHA = '13e89b7293d65b94f091b272897809f4b9680592df1e857e31ba96f4fa3bf3e3'


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--root', default='.artifacts/ci-world-sweep')
    a = p.parse_args()
    root = Path(a.root)
    root.mkdir(parents=True, exist_ok=True)
    archive = root / 'baseline.zip'
    started = time.monotonic()
    if not archive.exists() or hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest() != BASELINE_SHA:
        temporary = archive.with_suffix('.partial')
        size = 0
        with requests.get(BASELINE_URL, stream=True, timeout=(10, 60), allow_redirects=False) as response:
            response.raise_for_status()
            with temporary.open('wb') as out:
                for block in response.iter_content(131072):
                    size += len(block)
                    if size > 12 * 1024 * 1024:
                        raise RuntimeError('baseline_download_budget')
                    out.write(block)
        if hashlib.file_digest(temporary.open('rb'), 'sha256').hexdigest() != BASELINE_SHA:
            raise RuntimeError('public_baseline_sha256_mismatch')
        temporary.replace(archive)
    with zipfile.ZipFile(archive) as source:
        entry = source.getinfo(BASELINE_ENTRY)
        if entry.file_size > 60 * 1024 * 1024:
            raise RuntimeError('baseline_extract_budget')
        with source.open(entry) as inp, (root / 'baseline.csv').open('wb') as out:
            while True:
                block = inp.read(131072)
                if not block:
                    break
                out.write(block)
    subprocess.run(['node', 'scripts/catalog-inventory.cjs', str(root / 'inventory.json')], check=True)
    subprocess.run([sys.executable, 'scripts/catalog-world-sweep.py', '--inventory', str(root / 'inventory.json'),
                    '--baseline', str(root / 'baseline.csv'), '--source-plan', 'data/catalog-world-source-plan-20261021.json',
                    '--niches', 'data/catalog-active-niches-20261021.json', '--root', str(root), '--read-remote-missing',
                    '--seed', SEED, '--seed-sha256', SEED_SHA], check=True)
    report = json.loads((root / 'report.json').read_text())
    report.update(runnerElapsedMs=round((time.monotonic() - started) * 1000),
                  baselineArchiveSha256=BASELINE_SHA, baselineArchiveBytes=archive.stat().st_size,
                  previousCanonicalBusinessAssetsReplaced=False,
                  rawPartitionCacheUnavailableOnIndependentRunner=True)
    (root / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    notes = ('Varredura finita das fontes para todas as localidades enumeradas do Prospect AI.\n\n'
             f"Inventário: {report['inventoryCities']} localidades. Partições examinadas: "
             f"{len(report['sourcePartitionsExamined'])}/{report['sourcePartitionsRequired']}.\n"
             f"Registros de fonte examinados: {report['sourceObservationsExamined']}.\n"
             f"Localidades abaixo da meta com candidatos: {report['belowTargetCitiesWithCandidateObservations']}.\n\n"
             'Os candidatos precisam de validação geográfica e deduplicação. Este pacote não comprova '
             '50 empresas únicas em cada cidade e não publica novos registros no catálogo canônico.\n'
             'Fontes/licenças: Countries States Cities Database / OpenStreetMap (ODbL-1.0); '
             'Overture Maps Foundation Places (licenças por fonte preservadas; CDLA-Permissive-2.0, Apache-2.0, CC0-1.0).\n')
    (root / 'RELEASE_NOTES.md').write_text(notes)
    paths = [root / name for name in ('report.json', 'progress.json', 'all-app-cities.ndjson.gz', 'sweep.sqlite', 'inventory.json', 'RELEASE_NOTES.md')]
    paths += sorted(root.glob('source-ranges-*.json'))
    package = root / 'prospect-all-app-cities-source-sweep.zip'
    with zipfile.ZipFile(package, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as out:
        for path in paths:
            if path.is_file():
                out.write(path, path.name)
    checksum = hashlib.file_digest(package.open('rb'), 'sha256').hexdigest()
    (root / 'SHA256SUMS.txt').write_text(checksum + '  ' + package.name + '\n')
    print(json.dumps({'package': str(package), 'sha256': checksum, 'bytes': package.stat().st_size,
                      'inventoryCities': report['inventoryCities'], 'sourcePartitionsPending': report['sourcePartitionsPending'],
                      'targetCompletionClaimed': False}), flush=True)
    return 0 if report['sourceSweepComplete'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
