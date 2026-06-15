const { z } = require('zod');
const mongoose = require('mongoose');
const objectIdSchema = z.string().trim().refine((v) => mongoose.Types.ObjectId.isValid(v), 'অবৈধ আইডি।');
const schema = z.object({
  propertyId: objectIdSchema,
  message: z.string().trim().min(1, 'বার্তা লিখুন।').max(2000),
  leaseStart: z.union([z.string().datetime(), z.string().date(), z.null()]).optional(),
  leaseEnd: z.union([z.string().datetime(), z.string().date(), z.null()]).optional(),
});
const result = schema.safeParse({});
console.log(result.error.issues);
