"""Explicit one-time signed DuckDB extension install; no dataset scan."""
from pathlib import Path
import gzip,os,platform
import duckdb,requests
assert duckdb.__version__=="1.4.4","Install pinned tools/discovery-requirements.txt first"
architecture={"x86_64":"amd64","aarch64":"arm64"}.get(platform.machine())
assert platform.system()=="Linux" and architecture,"Use DuckDB's documented installer for this platform"
system="linux_"+architecture
url=f"https://extensions.duckdb.org/v1.4.4/{system}/httpfs.duckdb_extension.gz"
response=requests.get(url,timeout=30);response.raise_for_status()
assert len(response.content)<32*1024*1024
root=Path(os.environ.get("DUCKDB_EXTENSION_DIRECTORY",str(Path.home()/".duckdb/extensions")))/"v1.4.4"/system
root.mkdir(parents=True,exist_ok=True)
(root/"httpfs.duckdb_extension").write_bytes(gzip.decompress(response.content))
duckdb.connect().execute("LOAD httpfs") # DuckDB checks the extension signature.
print("Signed httpfs extension installed; TLS verification preserved.")
