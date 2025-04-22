const express = require('express');
const libgen = require('libgen');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT;
app.use(cors());

const DOWNLOAD_DIR = path.join(__dirname, 'temp_downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

function scheduleFileCleanup(filePath, delayMs = 120000) {
  setTimeout(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }, delayMs);
}

function getDownloadLink(html) {
  const $ = cheerio.load(html);
  return $("a").filter((_i, el) => $(el).text().includes("GET")).attr("href");
}

function getFileExtension(url) {
  const match = url.match(/\.([a-zA-Z0-9]+)(?:[\?#]|$)/);
  return match ? match[1] : "pdf";
}

app.get('/', async (req, res) => {
  const { isbn1, isbn2, book } = req.query;
  const queries = [isbn1, isbn2, book].filter(Boolean); // remove undefined/null

  if (queries.length === 0) return res.status(400).send('Missing search parameters');

  for (const query of queries) {
    try {
      console.log("here")
      const mirrorUrl = await libgen.mirror();
      const results = await libgen.search({ mirror: mirrorUrl, query, count: 1 });
      if (!results || results.length === 0) continue;

      const result = results[0];
      const downloadPageUrl = await libgen.utils.check.canDownload(result.md5);
      if (!downloadPageUrl) continue;

      const html = (await axios.get(downloadPageUrl)).data;
      const downloadLink = getDownloadLink(html);
      if (!downloadLink) continue;

      const fileResponse = await axios.get(downloadLink, {
        responseType: "arraybuffer",
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      const sanitizedTitle = result.title.replace(/[^a-zA-Z0-9]/g, "_");
      const extension = getFileExtension(downloadLink);
      const filename = `${sanitizedTitle}.${extension}`;
      const filePath = path.join(DOWNLOAD_DIR, filename);

      fs.writeFileSync(filePath, Buffer.from(fileResponse.data));
      scheduleFileCleanup(filePath);

      return res.redirect(`/${encodeURIComponent(query)}/download/${encodeURIComponent(filename)}`);
    } catch (err) {
      console.error(`Failed query "${query}":`, err.message);
      continue;
    }
  }

  return res.status(404).send("No matching book found with the provided data.");
});

app.get('/:query/download/:filename', (req, res) => {
  const filePath = path.join(DOWNLOAD_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('File not found or deleted');

  res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
