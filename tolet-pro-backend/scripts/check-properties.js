require('dotenv').config();
const mongoose = require('mongoose');
const Property = require('../models/Property');

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
mongoose.connect(uri).then(async () => {
  const total = await Property.countDocuments();
  console.log('Total properties in Mongo:', total);
  if (total > 0) {
    const sample = await Property.findOne().lean();
    console.log('\nSample property field names:');
    console.log(Object.keys(sample));
    console.log('\nOwner-like fields in sample:');
    console.log({
      owner: sample.owner,
      ownerId: sample.ownerId,
      landlord: sample.landlord,
      landlordId: sample.landlordId,
      host: sample.host,
      hostId: sample.hostId,
      createdBy: sample.createdBy,
      userId: sample.userId,
    });
  }
  await mongoose.disconnect();
});
