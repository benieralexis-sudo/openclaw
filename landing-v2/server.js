// iFIND Landing v2 — Static server pour Astro dist/
import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.LANDING_PORT || 3081;
const DIST_DIR = path.join(__dirname, 'dist');

app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        frameSrc: ["'self'", 'https://tally.so', 'https://cal.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'", 'https://tally.so'],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    strictTransportSecurity: false,
    xFrameOptions: false,
    xContentTypeOptions: false,
    referrerPolicy: false,
  }),
);

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, version: '2.0', service: 'ifind-landing' });
});

const oneYear = 365 * 24 * 60 * 60;
const oneHour = 60 * 60;

app.use(
  express.static(DIST_DIR, {
    extensions: ['html'],
    setHeaders: (res, filePath) => {
      if (/\.(svg|png|jpg|jpeg|gif|ico|webp|avif|woff2?|ttf|eot)$/i.test(filePath)) {
        res.setHeader('Cache-Control', `public, max-age=${oneYear}, immutable`);
      } else if (/\.(css|js)$/i.test(filePath)) {
        if (filePath.includes('_astro')) {
          res.setHeader('Cache-Control', `public, max-age=${oneYear}, immutable`);
        } else {
          res.setHeader('Cache-Control', `public, max-age=${oneHour}`);
        }
      } else if (/\.html$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
      } else if (/\.xml$/i.test(filePath)) {
        res.setHeader('Cache-Control', `public, max-age=${oneHour}`);
      }
    },
  }),
);

app.use((req, res) => {
  res.status(404).sendFile(path.join(DIST_DIR, 'index.html'), (err) => {
    if (err) res.status(404).type('text').send('404 — Page non trouvée');
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[iFIND Landing v2] Serveur démarré sur le port ${PORT}, dist: ${DIST_DIR}`);
});
