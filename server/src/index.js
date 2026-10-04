import { startServer } from './api.js';

const port = Number(process.env.PORT || 8888);
const dataDir = process.env.DATA_DIR || '/data';

startServer({ dataDir, port });
