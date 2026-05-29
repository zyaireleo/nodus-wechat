// ==UserScript==
// @name         Sub2API POC Reply From Webhook
// @description  Replies to WeChat with the JSON reply field returned by the POC webhook.
// @version      1.0.0
// @match        *
// @grant        none
// @timeout      3000
// ==/UserScript==

function onResponse(ctx) {
  if (!ctx.res || ctx.res.status < 200 || ctx.res.status >= 300) {
    ctx.reply("POC webhook failed. Check docker compose logs -f poc-webhook.");
    return;
  }

  let body = {};
  try {
    body = JSON.parse(ctx.res.body || "{}");
  } catch (err) {
    ctx.reply("POC webhook returned non-JSON response.");
    return;
  }

  if (body.reply) {
    ctx.reply(String(body.reply));
  }
}
