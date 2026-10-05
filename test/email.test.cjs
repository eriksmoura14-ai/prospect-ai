"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createMailer, probeConfiguration } = require("../email.cjs");

// Controlled transport fixtures verify handling and redaction, not live delivery.
const config = { apiKey: "fixture-private-api-key", from: "sender@example.test" };
const message = { email: "fixture@gmail.com", purpose: "activate", link: "https://app.example/#activate=fixture-private-link" };
const response = (value, status=200) => new Response(JSON.stringify(value), {status});
const noPrivateValues = records => {
  const text = JSON.stringify(records);
  for (const value of [config.apiKey, config.from, message.email, message.link, "fixture-private-link", "private-account-key", "raw-provider-secret"]) assert.ok(!text.includes(value));
};

test("Brevo diagnostics distinguish acceptance from rejection without logging private values", async () => {
  const records=[];
  await createMailer(config, async () => response({messageId:message.link},201), value=>records.push(value))(message);
  assert.equal(records[0].outcome,"accepted");
  assert.equal(records[0].httpStatus,201);
  const reject=createMailer(config, async()=>response({code:"unauthorized",message:`Key ${config.apiKey} not found; ${message.email} ${message.link}`},401), value=>records.push(value));
  await assert.rejects(reject(message), /não aceitou/);
  assert.equal(records[1].reason,"authentication_rejected");
  assert.equal(records[1].httpStatus,401);
  noPrivateValues(records);
});
test("Brevo diagnostics classify network failures and do not log raw errors", async () => {
  for (const [failure,expected] of [[Object.assign(new Error(message.link),{name:"TimeoutError"}),"request_timeout"],
    [Object.assign(new Error(config.apiKey),{cause:{code:"ECONNREFUSED"}}),"connection_failure"]]) {
    const records=[];
    await assert.rejects(createMailer(config,async()=>{throw failure;}, value=>records.push(value))(message));
    assert.equal(records[0].outcome,expected);
    noPrivateValues(records);
  }
});
test("Brevo startup probe is read-only and stops when authentication is rejected", async () => {
  const calls=[],records=[];
  const result=await probeConfiguration(config,async(url,options)=>{
    calls.push({url,options}); return response({message:config.apiKey},401);
  },value=>records.push(value));
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,"https://api.brevo.com/v3/account");
  assert.equal(calls[0].options.body,undefined);
  assert.equal(calls[0].options.redirect,"error");
  assert.equal(result.outcome,"authentication_rejected");
  noPrivateValues(records);
});
test("Brevo startup probe distinguishes inactive relay, sender verification, and delivery events", async () => {
  const records=[],calls=[];
  const result=await probeConfiguration(config,async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/account')) return response({email:message.email,marketingAutomation:{key:"private-account-key"},relay:{enabled:false}});
    if(url.endsWith('/senders')) return response({senders:[{email:config.from,active:true}]});
    return response({events:[{from:config.from,email:message.email,subject:"Confirme seu e-mail no Prospect AI",event:"blocked",reason:"SMTP account not activated raw-provider-secret"},
      {from:config.from,email:message.email,subject:"Unrelated private campaign",event:"delivered"}]});
  },value=>records.push(value));
  assert.equal(result.outcome,"transactional_disabled");
  assert.equal(result.senderActive,true);
  assert.deepEqual(result.recentEvents,[{event:"blocked",reason:"transactional_disabled"}]);
  assert.equal(calls.length,3);
  assert.ok(calls.every(({url,options})=>url.startsWith("https://api.brevo.com/v3/")&&!options.body&&!options.method));
  noPrivateValues(records);
});
test("Brevo startup probe does not claim sender readiness when verification is missing", async()=>{
  for(const [senders,expected] of [[[],"sender_missing"],[[{email:config.from,active:false}],"sender_unverified"]]) {
    const result=await probeConfiguration(config,async url=>url.endsWith('/account')?response({relay:{enabled:true}}):url.endsWith('/senders')?response({senders}):response({events:[]}),()=>{});
    assert.equal(result.outcome,expected);
  }
});
test("Brevo diagnostics bound provider responses and tolerate broken logging", async()=>{
  const records=[];
  await assert.rejects(createMailer(config,async()=>new Response('x'.repeat(100000),{status:400}),value=>records.push(value))(message));
  assert.equal(records[0].reason,"provider_rejected");
  await createMailer(config,async()=>response({},201),()=>{throw new Error("logger failed");})(message);
  const result=await probeConfiguration(config,async()=>new Response('x'.repeat(100000)),()=>{});
  assert.equal(result.outcome,"invalid_response");
});
