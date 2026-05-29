require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const TARGET_ID = '6a08e711f15e92b1debec8ae';

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
mongoose.connect(uri).then(async () => {
  const result = await User.findByIdAndUpdate(
    TARGET_ID,
    { role: 'super_admin' },
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
