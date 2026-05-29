require('dotenv').config();
const mongoose = require('mongoose');
const Property = require('../models/Property');
const User = require('../models/User');

mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI).then(async () => {
  const props = await Property.find().lean();
  console.log('Total properties:', props.length);
  console.log('');
  for (const p of props) {
    const owner = await User.findById(p.ownerUserId).lean();
    console.log('Title       :', p.title);
    console.log('Status      :', p.status);
    console.log('Created     :', p.createdAt);
    console.log('Owner ID    :', p.ownerUserId);
    console.log('Owner name  :', p.ownerName);
    console.log('Owner role  :', owner ? owner.role : '(user not found)');
    console.log('Owner phone :', owner ? (owner.phone || owner.phoneNumber) : 'n/a');
    console.log('');
  }
  await mongoose.disconnect();
});
