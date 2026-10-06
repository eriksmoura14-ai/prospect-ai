"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const contacts = require("../contacts.cjs"), { snapshot } = require("../prospects.cjs");

test("telefone nacional usa o país correto e preserva o zero necessário na Itália", () => {
  for (const [phone, country, number] of [
    ["(11) 91234-5678", "BR", "5511912345678"],
    ["(212) 555-0100", "US", "12125550100"],
    ["020 7946 0958", "GB", "442079460958"],
    ["02 3661 8300", "IT", "390236618300"],
    ["090-1234-5678", "JP", "819012345678"],
    ["030 901820", "DE", "4930901820"]
  ]) assert.equal(contacts.whatsappURL(phone, country), "https://wa.me/" + number);
});

test("código internacional explícito tem prioridade e prefixos de saída são tratados pelo país", () => {
  assert.equal(contacts.whatsappURL("+1 (212) 555-0100", "BR"), "https://wa.me/12125550100");
  assert.equal(contacts.whatsappURL("+44 20 7946 0958"), "https://wa.me/442079460958");
  assert.equal(contacts.whatsappURL("011 44 20 7946 0958", "US"), "https://wa.me/442079460958");
  assert.equal(contacts.whatsappURL("00 44 20 7946 0958", "DE"), "https://wa.me/442079460958");
});

test("telefones incompletos e texto arbitrário não viram destinatários", () => {
  for (const phone of ["", "123", "(11) 91234-5678", "javascript:alert(5511912345678)",
    "<a href=evil>+5511912345678</a>", "Ligue para +5511912345678", "x".repeat(201), null, {}]) {
    assert.equal(contacts.whatsappURL(phone), "");
  }
  assert.equal(contacts.whatsappURL("123", "BR"), "");
  assert.equal(contacts.whatsappURL("(11) 91234-5678", "ZZ"), "");
});

test("números múltiplos usam o primeiro válido e ramal impede destinatário automático", () => {
  assert.equal(contacts.whatsappURL("123; +44 20 7946 0958; +1 212 555 0100", "BR"), "https://wa.me/442079460958");
  assert.equal(contacts.whatsappURL("+1 212 555 0100, +44 20 7946 0958"), "https://wa.me/12125550100");
  assert.equal(contacts.whatsappURL("(11) 91234-5678 ext. 123", "BR"), "");
  assert.equal(contacts.details({phone:"tel:+5511912345678;ext=123",countryCode:"BR"}).whatsappReason,"extension");
  assert.equal(contacts.whatsappURL("+5511912345678;ext=123", "BR"), "");
});

test("metadados do histórico definem o país e URLs fornecidas são recalculadas", () => {
  const job = { discoveryDiagnostics: { geocode: { selected: { address: { country_code: "br" } } }, location: { countryCode: "US" } } };
  const original = { phone: "(11) 91234-5678", whatsappUrl: "https://evil.example/", name: "Empresa" };
  assert.equal(contacts.jobCountry(job), "BR");
  const result = contacts.details(original, contacts.jobCountry(job));
  assert.equal(result.whatsappUrl, "https://wa.me/5511912345678");
  assert.equal(result.phone, original.phone); assert.equal(original.countryCode, undefined);
  assert.equal(contacts.details({ phone: "(212) 555-0100", countryCode: "US" }, "BR").whatsappUrl, "https://wa.me/12125550100");
  assert.equal(contacts.jobCountry({ discoveryDiagnostics: { location: { countryCode: "GB" } } }), "GB");
});

test("listas preservam o país necessário e não aceitam uma URL de contato forjada", () => {
  const company = snapshot({ osmId: "node/1", name: "Empresa", phone: "020 7946 0958", whatsappPhone: "020 7946 0958", countryCode: "gb", whatsappUrl: "javascript:alert(1)" });
  assert.equal(company.countryCode, "GB"); assert.equal(company.whatsappUrl, "https://wa.me/442079460958");
  assert.equal(contacts.details({ phone: "+1 212 555 0100" }).whatsappUrl, "https://wa.me/12125550100");
  assert.equal(contacts.details({ phone: "020 7946 0958" }).whatsappUrl, "");
});

test("celular brasileiro antigo exige revisão e nunca troca automaticamente os dígitos publicados", () => {
  for (const phone of ["+55 34 9123-4567", "(34) 9123-4567", "034 9123-4567"]) {
    const result = contacts.details({ phone, countryCode: "BR" });
    assert.equal(result.phone, phone);
    assert.equal(result.whatsappUrl, "");
    assert.equal(result.whatsappNumber, "");
    assert.equal(result.whatsappSuggestedUrl, "https://wa.me/5534991234567");
    assert.equal(result.whatsappSuggestedNumber, "+5534991234567");
    assert.equal(result.whatsappStatus, "needs_review");
    assert.equal(result.whatsappAdjustment, "br_ninth_digit");
  }
  assert.equal(contacts.details({phone:"+55 34 8765-4321"}).whatsappSuggestedUrl, "https://wa.me/5534987654321");
  assert.equal(contacts.details({phone:"+55 34 6543-2109"}).whatsappSuggestedUrl, "https://wa.me/5534965432109");
  assert.equal(contacts.whatsappURL("+55 34 8765-4321"), "");
});

test("nono dígito não duplica em celular completo nem altera fixos, faixa 7 ou outros países", () => {
  for (const [phone, country, url] of [
    ["+55 34 99123-4567", "BR", "https://wa.me/5534991234567"],
    ["(34) 3456-7890", "BR", ""],
    ["+55 34 7654-3210", "BR", "https://wa.me/553476543210"],
    ["+1 212 555 0100", "BR", "https://wa.me/12125550100"],
    ["020 7946 0958", "GB", ""]
  ]) {
    const result = contacts.details({ phone, countryCode: country });
    assert.equal(result.whatsappUrl, url); assert.equal(result.whatsappAdjustment, "");
  }
  assert.equal(contacts.whatsappURL("(00) 9123-4567", "BR"), "");
  assert.equal(contacts.whatsappURL("9123-4567", "BR"), "");
  assert.equal(contacts.whatsappURL("(34) 912-4567", "BR"), "");
});

test("campos de celular e contatos adicionais são preservados sem trocar fixo por celular", () => {
  const data = contacts.sourceData({phone:"(34) 3456-7890","contact:phone":"(34) 3234-5678","contact:mobile":"(34) 99123-4567"});
  const result = contacts.details({...data,countryCode:"BR"});
  assert.equal(result.phone,"(34) 3456-7890; (34) 3234-5678; (34) 99123-4567");
  assert.equal(result.whatsappUrl,"https://wa.me/5534991234567");
  assert.match(result.phoneSource,/contact:mobile/);
  assert.equal(result.phoneVerification,"listed");
});

test("WhatsApp explicitamente cadastrado tem prioridade e não aceita links de outros hosts", () => {
  const data = contacts.sourceData({phone:"(34) 3456-7890","contact:whatsapp":"https://wa.me/5534991234567"});
  assert.equal(contacts.details({...data,countryCode:"BR"}).whatsappUrl,"https://wa.me/5534991234567");
  const bad = contacts.sourceData({"contact:whatsapp":"https://wa.me.evil.example/5534991234567"});
  assert.equal(bad.phone,"");assert.equal(bad.whatsappPhone,"");
});

test("site inválido não oculta outra URL válida e contatos do provedor mantêm sua origem", () => {
  const data = contacts.sourceData({website:"javascript:alert(1)","contact:website":"empresa.example.br"}, {phone:"+55 34 99123-4567",website:"https://different.example/"});
  assert.equal(data.website,"https://empresa.example.br/");
  assert.equal(data.websiteSource,"OpenStreetMap · contact:website");
  assert.equal(data.phoneSource,"Geoapify · contact.phone");
  assert.equal(data.invalidListedWebsite,false);
  const providerOnly = contacts.sourceData({}, {website:"https://provider.example/"});
  assert.equal(providerOnly.websiteSource,"Geoapify · website");
  for (const url of ["file:///etc/passwd","ftp://example.com","http://user:secret@example.com/","http://localhost/",{}]) assert.equal(contacts.websiteURL(url),"");
});

test("telefones divergentes conservam os dados e bloqueiam destinatário automático, inclusive nas listas", () => {
  const data = {osmId:"node/1",phone:"(34) 3456-7890",countryCode:"BR",phoneVerification:"conflict",
    sitePhone:"+5534991234567",phoneSource:"OpenStreetMap · phone",websiteVerification:"compatible",websiteSource:"OpenStreetMap · website"};
  const result = snapshot(data);
  assert.equal(result.phone,data.phone);assert.equal(result.sitePhone,data.sitePhone);
  assert.equal(result.phoneVerification,"conflict");assert.equal(result.whatsappUrl,"");
  assert.equal(result.websiteVerification,"compatible");assert.equal(result.phoneSource,data.phoneSource);
});

test("comparação de telefone usa código internacional e não apenas os dez últimos dígitos", () => {
  assert.deepEqual(contacts.numbers("+1 212 555 0100; (212) 555-0100","US"),["+12125550100"]);
  assert.deepEqual(contacts.numbers("+55 34 9123-4567","BR"),[]);
});

test("caso relatado Amo Pizza: formato de fixo válido não comprova conta WhatsApp", () => {
  const row={phone:"+553432249090",countryCode:"BR"};
  const result=contacts.details(row);
  assert.equal(result.phone,row.phone);assert.equal(result.whatsappUrl,"");
  assert.equal(result.whatsappReason,"fixed_line");assert.equal(result.whatsappAdjustment,"");
  // A landline CAN be registered in WhatsApp Business; an explicit published
  // WhatsApp field changes the evidence, not the number or account existence.
  const listed=contacts.details({...row,whatsappPhone:row.phone});
  assert.equal(listed.whatsappUrl,"https://wa.me/553432249090");assert.equal(listed.whatsappStatus,"listed");
});

test("mobile válido continua não verificado e serviço especial/ramal não recebe link automático", () => {
  const row=contacts.details({phone:"+5511991234567",countryCode:"BR",whatsappStatus:"verified",whatsappUrl:"https://evil.example/"});
  assert.equal(row.whatsappUrl,"https://wa.me/5511991234567");assert.equal(row.whatsappStatus,"unverified");
  for(const phone of ["0800 123 4567","+55 11 91234-5678 ext. 123"]) {
    assert.equal(contacts.details({phone,whatsappPhone:phone,countryCode:"BR"}).whatsappUrl,"");
  }
});

test("URLs oficiais normalizam país uma só vez sem enviar texto pré-preenchido", () => {
  for(const value of ["https://wa.me/5534991234567?text=Oi%2C%20empresa","https://api.whatsapp.com/send?phone=5534991234567&text=Oi","https://web.whatsapp.com/send?phone=5534991234567"]) {
    const source=contacts.sourceData({phone:"+553432249090","contact:whatsapp":value});
    const row=contacts.details({...source,countryCode:"US"});
    assert.equal(row.whatsappUrl,"https://wa.me/5534991234567");assert.equal(row.whatsappStatus,"listed");
  }
  for(const value of ["https://wa.me.evil.example/5534991234567","https://api.whatsapp.com.evil.example/send?phone=5534991234567","https://evil@wa.me/5534991234567","http://wa.me/5534991234567","https://wa.me/message/OTHER","https://api.whatsapp.com/send?phone=5534991234567&phone=12125550100"]) assert.equal(contacts.whatsappLinkNumber(value),"");
});

test("listas recalculam evidência e sugestão sem confiar em destinatários antigos", () => {
  const row=snapshot({osmId:"node/1",phone:"+553432249090",countryCode:"BR",whatsappUrl:"https://wa.me/553432249090",whatsappStatus:"verified",whatsappSuggestedUrl:"https://wa.me/5511991234567"});
  assert.equal(row.whatsappUrl,"");assert.equal(row.whatsappSuggestedUrl,"");
  const listed=snapshot({...row,whatsappPhone:"+553432249090",whatsappSource:"https://fixture.example/contact"});
  assert.equal(listed.whatsappStatus,"listed");assert.equal(listed.whatsappSource,"https://fixture.example/contact");
});

test("número que coincide com o site tem prioridade sobre outro telefone da fonte",()=>{
  const row={phone:"(11) 3456-7890; (11) 99123-4567",mobilePhone:"(11) 99876-5432",countryCode:"BR",
    sitePhone:"+5511991234567",phoneVerification:"website_match"};
  assert.equal(contacts.details(row).whatsappUrl,"https://wa.me/5511991234567");
  assert.equal(contacts.details({...row,whatsappPhone:"+5511998765432"}).whatsappUrl,"https://wa.me/5511998765432");
  assert.equal(contacts.details(row).phone,row.phone);
});
