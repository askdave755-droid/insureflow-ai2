// Shared pg-style pool shim over Prisma.
// $queryRawUnsafe supports the $1 positional params used by the
// original carrier/life route SQL and lib/lifePipeline.js.
const prisma = require('../db');

module.exports = {
  query: async (sql, params) => ({ rows: await prisma.$queryRawUnsafe(sql, ...(params || [])) })
};
