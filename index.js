require('dotenv').config();
const { App } = require('@slack/bolt');
const axios = require('axios');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: false
});

// Saudi number validation (05xxxxxxxxx or +9665xxxxxxxx)
function isSaudiNumber(num) {
  const n = num.replace(/[\s\-]/g, '');
  return /^(05\d{8}|\+9665\d{8}|009665\d{8})$/.test(n);
}

// Normalize number to international format
function normalizeNumber(num) {
  const n = num.replace(/[\s\-]/g, '');
  if (n.startsWith('05')) return '+966' + n.slice(1);
  if (n.startsWith('009665')) return '+966' + n.slice(5);
  return n;
}

// Send SMS via api.mobile.net.sa
async function sendSMS(to, message) {
  try {
    const response = await axios.post('https://api.mobile.net.sa/send', {
      api_key: process.env.SMS_API_KEY,
      sender: process.env.SMS_SENDER,
      mobile: to,
      message: message
    });
    return { success: true, data: response.data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// /sms command - single or multiple numbers
app.command('/sms', async ({ command, ack, respond }) => {
  await ack();
  const args = command.text.trim().split(' ');
  if (args.length < 2) {
    await respond('\u274c الاستخدام: /sms [رقم أو أرقام مفصولة بفاصلة] [نص الرسالة]\nمثال: /sms 0501234567 مرحبا');
    return;
  }
  const numbers = args[0].split(',');
  const message = args.slice(1).join(' ');
  const results = [];

  for (const num of numbers) {
    const trimmed = num.trim();
    if (!isSaudiNumber(trimmed)) {
      results.push({ number: trimmed, status: '\u274c رقم غير صحيح' });
      continue;
    }
    const normalized = normalizeNumber(trimmed);
    const result = await sendSMS(normalized, message);
    results.push({
      number: trimmed,
      status: result.success ? '\u2705 تم الإرسال' : '\u274c فشل: ' + result.error
    });
  }

  const report = results.map(r => `*${r.number}*: ${r.status}`).join('\n');
  const senderInfo = `\n\n_المرسل: ${process.env.SMS_SENDER}_`;
  await respond({
    text: `*نتائج إرسال SMS*\n${report}${senderInfo}`,
    response_type: 'ephemeral'
  });
});

// /smsgroup command - send to a group
app.command('/smsgroup', async ({ command, ack, respond }) => {
  await ack();
  const args = command.text.trim().split(' ');
  if (args.length < 2) {
    await respond('\u274c الاستخدام: /smsgroup [اسم_المجموعة] [نص الرسالة]');
    return;
  }
  const groupName = args[0];
  const message = args.slice(1).join(' ');

  // Groups stored in ENV as JSON: GROUPS={"sales":["0501111111","0502222222"]}
  let groups = {};
  try {
    groups = JSON.parse(process.env.SMS_GROUPS || '{}');
  } catch(e) {}

  const groupNumbers = groups[groupName];
  if (!groupNumbers || groupNumbers.length === 0) {
    await respond(`\u274c المجموعة "${groupName}" غير موجودة. المجموعات المتاحة: ${Object.keys(groups).join(', ') || 'لا يوجد'}`);
    return;
  }

  const results = [];
  for (const num of groupNumbers) {
    const normalized = normalizeNumber(num);
    const result = await sendSMS(normalized, message);
    results.push({ number: num, status: result.success ? '\u2705 تم' : '\u274c فشل' });
  }

  const report = results.map(r => `*${r.number}*: ${r.status}`).join('\n');
  await respond({
    text: `*إرسال SMS للمجموعة: ${groupName}*\n${report}\n_المرسل: ${process.env.SMS_SENDER}_`,
    response_type: 'ephemeral'
  });
});

// /smsstatus command - show last status
app.command('/smsstatus', async ({ command, ack, respond }) => {
  await ack();
  await respond({
    text: `*حالة خدمة Corbit SMS*\n\u2705 الخدمة تعمل بشكل طبيعي\n*المرسل:* ${process.env.SMS_SENDER}\n*SMS API:* api.mobile.net.sa`,
    response_type: 'ephemeral'
  });
});

// Start the app
(async () => {
  const port = process.env.PORT || 3000;
  await app.start(port);
  console.log(`\u26a1 Corbit SMS Slack App is running on port ${port}`);
})();
