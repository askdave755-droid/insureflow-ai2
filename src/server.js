const express = require('express');
const app = express();
app.get('/health', (req, res) => res.json({ status: 'ok', test: true }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Test server on ${PORT}`));
