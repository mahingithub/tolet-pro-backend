const { z } = require('zod');
const { updateProperty } = require('./validators/property.validators');

const payload = {
  title: "Commercial Space in Dhaka",
  location: "Dhaka",
  beds: 0,
  baths: 2,
  sqft: 2000,
  floor: 1,
  furnishing: "Unfurnished",
  description: "",
  status: "active",
  coverPhoto: "https://example.com/img.jpg",
  price: 45000,
  specificDetails: {
    commercialType: 'office',
    generator: true
  },
};

try {
  updateProperty.parse(payload);
  console.log("Success!");
} catch (e) {
  console.log("Validation failed:", e.errors);
}
