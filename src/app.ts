import express from 'express';
import dotenv from 'dotenv';
import router from './routes';

dotenv.config();

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(router);

export default app;
