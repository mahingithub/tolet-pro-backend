const { z } = require('zod');
const { updateProperty } = require('./validators/property.validators');

const payload = {
  title: "Some title",
  location: "Some location",
  beds: 2,
  baths: 2,
  sqft: 1200,
  floor: 3,
  furnishing: "Furnished",
  description: "Test description",
  status: "active",
  coverPhoto: "",
  price: 15000,
  specificDetails: {},
};

try {
  updateProperty.parse(payload);
  console.log("Success!");
} catch (e) {
  console.log("Validation failed:", e.errors);
}
