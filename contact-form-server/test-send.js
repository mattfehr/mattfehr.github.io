require('dotenv').config();
const nodemailer = require('nodemailer');

async function send() {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // SSL
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS, // App Password
    },
  });

  await transporter.sendMail({
    from: `"Tester" <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_USER,
    subject: 'SMTP test',
    text: 'If you received this, SMTP works locally.',
  });

  console.log('✅ Email sent successfully');
}

send().catch(err => {
  console.error('❌ Email failed:', err);
});
