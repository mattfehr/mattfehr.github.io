require('dotenv').config(); //load environment variables

//imports for building api, using gmail and middleware from other origin requests
const express = require('express');         
const nodemailer = require('nodemailer');   
const cors = require('cors');

//create express app and middleware
const app = express();
app.use(cors());                                  //cross origin requests
app.use(express.json());                          //parse json
app.use(express.urlencoded({ extended: true }));  //form data

//POST endpoint
app.post('/contact', async (req, res) => {
  const { name, email, message } = req.body;

  //configure gmail SMTP server
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  //email details
  const mailOptions = {
    from: `"${name}" <${process.env.EMAIL_USER}>`, 
    to: process.env.EMAIL_USER,
    subject: `Contact Form Message from ${name}`,
    text: `
  You have a new contact form submission:

  Name: ${name}
  Email: ${email}
  Message:
  ${message}
    `,
    replyTo: email  //respond to the sender
  };

  //try to send the email
  try {
    await transporter.sendMail(mailOptions);
    res.status(200).send({ success: true, message: 'Email sent successfully!' });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).send({ success: false, message: 'Email failed to send.' });
  }
});

//start the server on localhost:3000 for local deployment
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

