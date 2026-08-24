const mongoose = require('mongoose');
require('dotenv').config();
const Booking = require('./models/Booking');

async function test() {
  await mongoose.connect(process.env.MONGO_URI);
  try {
    const booking = new Booking({
      landlordId: new mongoose.Types.ObjectId(),
      property: "Test Property",
      tenant: "John Doe",
      monthlyRent: 5000,
      leaseStart: new Date(),
    });
    await booking.validate();
    console.log("Validation passed!");
  } catch (err) {
    console.error("Validation failed:", err.message);
  }
  mongoose.disconnect();
}
test();
