const mongoose = require('mongoose');
mongoose.connect('mongodb://127.0.0.1:27017/tolet-pro');

async function test() {
  const Booking = require('./models/Booking');
  const b = await Booking.findOne().lean();
  console.log(Object.keys(b));
  process.exit();
}
test();
