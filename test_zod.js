const { z } = require('zod');
const schema = z.object({
  status: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
});
console.log(schema.safeParse({ status: 'active', limit: '100', minPrice: '0', maxPrice: '300000' }));
