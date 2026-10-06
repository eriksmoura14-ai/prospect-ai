"use strict";
// Controlled HTML/DNS/HTTP fixtures are regressions, not live-business proof.
const {test} = require("node:test"), assert = require("node:assert/strict");
const evidence = require("../website-evidence.cjs");
const business = {name:"Empresa Central",city:"São Paulo",street:"Rua Central",houseNumber:"123",countryCode:"BR",phone:""};
const entity = extra => ({"@type":"LocalBusiness",name:business.name,
  address:{"@type":"PostalAddress",addressLocality:"São Paulo",streetAddress:"Rua Central, 123",addressCountry:"BR"},telephone:"+55 11 3456-7890",...extra});
const page = records => ({status:200,finalUrl:"https://fixture.example/",html:"<title>Empresa Central</title><p>São Paulo, Rua Central 123</p>" +
  '<script type="application/ld+json">' + JSON.stringify(records) + "</script>"});

test("telefone de cadastro estruturado da mesma empresa preenche campo ausente com fonte",()=>{
  const result = evidence.enrichPhone(page(entity()),business);
  assert.equal(result.phone,"+551134567890");
  assert.equal(result.phoneSource,"https://fixture.example/");
  assert.equal(result.phoneVerification,"website_published");
  assert.equal(evidence.analyze(page(entity()),business).compatible,true);
});
test("telefone do rodapé, de outra filial ou de outra empresa não preenche o contato",()=>{
  for (const record of [entity({name:"Outra Empresa"}),entity({address:{addressLocality:"São Paulo",streetAddress:"Rua Central 456"}}),entity({address:{addressLocality:"Curitiba",streetAddress:"Rua Central 123"}})])
    assert.deepEqual(evidence.enrichPhone({...page(record),html:page(record).html + '<footer><a href="tel:+5511991234567">Desenvolvedor</a></footer>'},business),{});
  assert.deepEqual(evidence.enrichPhone({...page([]),html:page([]).html + '<footer><a href="tel:+5511991234567">Desenvolvedor</a></footer>'},business),{});
});
test("mais de um contato estruturado para a mesma identidade permanece ambíguo",()=>{
  assert.deepEqual(evidence.enrichPhone(page([entity(),entity({telephone:"+55 11 99123-4567"})]),business),{});
});
test("telefone conflitante não substitui o original e registra a divergência",()=>{
  const result = evidence.enrichPhone(page(entity()),{...business,phone:"+55 11 99123-4567"});
  assert.equal(result.phone,undefined);assert.equal(result.phoneVerification,"conflict");assert.equal(result.sitePhone,"+551134567890");
  assert.equal(evidence.enrichPhone(page(entity()),{...business,phone:"(11) 3456-7890"}).phoneVerification,"website_match");
});
test("telefones internacionais com mesmos dígitos nacionais não confirmam uma identidade",()=>{
  const row = {name:"Empresa Central",city:"New York",countryCode:"US",phone:"+1 212 555 0100"};
  const result = evidence.analyze({status:200,html:"<title>Empresa Central</title><p>New York +55 21 2555 0100</p>"},row);
  assert.equal(result.nameMatch,true);assert.equal(result.cityMatch,true);
  assert.equal(result.phoneMatch,false);assert.equal(result.compatible,false);
});
test("ramal e números múltiplos são comparados individualmente em texto e links tel",()=>{
  const row = {...business,phone:"123; +55 11 3456-7890"};
  const sample = {status:200,html:'<title>Empresa Central</title><p>São Paulo</p><a href="tel:+551134567890">Telefone</a>'};
  assert.equal(evidence.analyze(sample,row).phoneMatch,true);
  assert.equal(evidence.analyze(sample,row).compatible,true);
});
test("WhatsApp do site só é aproveitado quando coincide com telefone da mesma identidade",()=>{
  const linked={...page(entity()),html:page(entity()).html+'<a href="https://api.whatsapp.com/send?phone=551134567890&amp;text=Oi">WhatsApp</a>'};
  const result=evidence.enrichPhone(linked,business);
  assert.equal(result.whatsappPhone,"+551134567890");assert.equal(result.whatsappSource,linked.finalUrl);
  const contact=require("../contacts.cjs").details({...business,...result});
  assert.equal(contact.whatsappStatus,"listed");assert.equal(contact.whatsappUrl,"https://wa.me/551134567890");
  const developer={...page(entity()),html:page(entity()).html+'<footer><a href="https://wa.me/5511991234567">Desenvolvedor</a></footer>'};
  assert.equal(evidence.enrichPhone(developer,business).whatsappPhone,undefined);
  assert.equal(evidence.enrichPhone({...linked,status:404},business).whatsappPhone,undefined);
});
test("comparação com site não trata um nono dígito inventado como telefone confirmado",()=>{
  const row={...business,phone:"+55 34 9123-4567"};
  const sample={status:200,html:'<title>Empresa Central</title><p>São Paulo +55 34 99123-4567</p>'};
  assert.equal(evidence.analyze(sample,row).phoneMatch,false);assert.equal(evidence.analyze(sample,row).compatible,false);
});
test("alfabetos não latinos, JSON-LD em grafos e entidades HTML são aceitos sem executar scripts",()=>{
  const row = {name:"中央理髪店",city:"東京",street:"渋谷区神宮前",houseNumber:"1",countryCode:"JP",phone:""};
  const sample = {status:200,finalUrl:"https://fixture.example/",html:'<script type="application/ld+json">'+JSON.stringify({"@graph":[{name:row.name,address:{addressLocality:row.city,streetAddress:row.street+" 1",addressCountry:"JP"},telephone:"+81 90 1234 5678"}]})+'</script>'};
  assert.equal(evidence.analyze(sample,row).compatible,true);assert.equal(evidence.enrichPhone(sample,row).phone,"+819012345678");
  assert.equal(evidence.analyze({status:200,html:"<title>A &amp; B</title><p>São Paulo Rua Central 123</p>"},{...business,name:"A & B"}).nameMatch,true);
  assert.deepEqual(evidence.enrichPhone({...page([]),html:page([]).html + '<script type="application/ld+json">alert(1)</script>'},business),{});
});
test("HTTP de erro ou domínio estacionado não vira site compatível",()=>{
  assert.equal(evidence.analyze({...page(entity()),status:404},business).compatible,false);
  assert.equal(evidence.analyze({...page(entity()),html:page(entity()).html + "<p>Domain for sale</p>"},business).compatible,false);
});
test("domínios nacionais ampliam candidatos sem remover os sufixos globais",()=>{
  const values = evidence.candidates("Empresa Central","São Paulo","BR");
  for (const suffix of [".com.br",".br",".com",".ca",".net",".org"]) assert.ok(values.includes("empresacentral"+suffix));
  assert.ok(evidence.candidates("Central Barber","London","GB").includes("centralbarber.co.uk"));
  assert.ok(evidence.candidates("中央理髪店","東京","JP").every(domain => /^[a-z\d.-]+$/.test(domain)));
});
test("perfis sociais e diretórios não comprovam site próprio",()=>{
  for (const input of ["https://instagram.com/empresa","https://www.facebook.com/empresa","https://maps.app.goo.gl/record","https://www.google.com/maps/place/company"]) assert.equal(evidence.isProfile(input),true);
  assert.equal(evidence.isProfile("https://instagram.com.evil.example/"),false);
  assert.equal(evidence.isProfile("https://company.example/"),false);
});
test("robots considera caminho, wildcard, fim, grupo específico e precedência de Allow",()=>{
  const robots = "User-agent: *\nDisallow: /admin\nDisallow: /*?private=$\nAllow: /admin/public";
  assert.equal(evidence.robotsPermit(robots,"/"),true);
  assert.equal(evidence.robotsPermit(robots,"/admin"),false);
  assert.equal(evidence.robotsPermit(robots,"/admin/public"),true);
  assert.equal(evidence.robotsPermit(robots,"/file?private="),false);
  assert.equal(evidence.robotsPermit(robots,"/file?private=other"),true);
  assert.equal(evidence.robotsPermit("User-agent: *\nDisallow: /\n\nUser-agent: ProspectAI\nAllow: /", "/"),true);
  assert.equal(evidence.robotsPermit("User-agent: ProspectAI\nDisallow: /\nAllow: /", "/"),true);
});
test("página bloqueada, política ilegível ou erro de robots não é lida",async()=>{
  for (const response of [{status:200,html:"User-agent: *\nDisallow: /"},{status:503,html:""},{status:200,html:"",policyReadable:false}]) {
    const calls=[];
    await assert.rejects(evidence.readPublicPage("https://fixture.example/",Date.now()+5000,async url=>{calls.push(url);return response;}));
    assert.deepEqual(calls,["https://fixture.example/robots.txt"]);
  }
});
test("caminhos percent-encoded e não latinos respeitam a mesma restrição de robots",()=>{
  assert.equal(evidence.robotsPermit("User-agent: *\nDisallow: /private","/%70rivate"),false);
  assert.equal(evidence.robotsPermit("User-agent: *\nDisallow: /café","/caf%C3%A9"),false);
  assert.equal(evidence.robotsPermit("User-agent: *\nDisallow: /%70rivate","/private"),false);
});
test("redirecionamento da página exige política do novo destino antes de sua leitura",async()=>{
  const calls=[];
  const result=await evidence.readPublicPage("https://fixture.example/",Date.now()+5000,async url=>{
    calls.push(url);
    if(url.endsWith("robots.txt"))return {status:404,html:""};
    if(url==="https://fixture.example/")return {status:302,redirect:"https://other.example/"};
    return {status:200,html:"Allowed",finalUrl:url};
  });
  assert.equal(result.finalUrl,"https://other.example/");
  assert.deepEqual(calls,["https://fixture.example/robots.txt","https://fixture.example/","https://other.example/robots.txt","https://other.example/"]);
});
