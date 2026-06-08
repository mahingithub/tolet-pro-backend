require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const TARGET_ID = '6a1d6f6d1fceebda9546b070'; // Asraf's ID

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
mongoose.connect(uri).then(async () => {
  const result = await User.findByIdAndUpdate(
    TARGET_ID,
    { 
      $set: { role: 'super_admin' },
      $addToSet: { roles: 'super_admin' }
    },
    { new: true }
  ).lean();
  if (result) {
    console.log('✓ Promoted to super_admin:');
    console.log('  id   :', result._id);
    console.log('  name :', result.name);
    console.log('  phone:', result.phone || result.phoneNumber);
    console.log('  role :', result.role);
  } else {
    console.log('✗ User not found with id', TARGET_ID);
  }
  await mongoose.disconnect();
});
