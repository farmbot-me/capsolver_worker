// server.js
const https = require("https");
const fs = require("fs");
const express = require("express");
const path = require("path");
const { logger } = require("../common/logger.js");
const cors = require("cors");
const taskMap = new Map();

const startTrunstileServer = (port) => {
  const app = express();

  // set cors
  app.use(cors());

  // set body parser
  app.use(express.json());

  app.get("/turnstile", (req, res) => {
    fs.readFile(__dirname + "/index.html", "utf8", (err, data) => {
      if (err) {
        res.status(500).send("Error reading file");
        return;
      }
      // Replace the hardcoded port with the dynamic port
      const modifiedHtml = data.replace(
        "{{SERVER_URL}}",
        `https://localhost:${port}`
      );
      res.send(modifiedHtml);
    });
  });

  app.post("/api/result", (req, res) => {
    const { task_id, value } = req.body;
    logger.info(`✅ Cloudflare Turnstile result received. task_id: ${task_id}`);
    taskMap.set(task_id, value);
    res.json({ success: true });
  });

  const certsFolder = path.join(__dirname, "certs");
  const options = {
    key: fs.readFileSync(path.join(certsFolder, "server.key")), // 你的私钥
    cert: fs.readFileSync(path.join(certsFolder, "server.crt")), // 你的证书
  };

  https.createServer(options, app).listen(port, () => {
    logger.info(
      `💡 Fake Turnstile HTTPS server running at https://localhost:${port}`
    );
  });
};

const waitForTurnstileTaskResult = (task_id, timeout = 60000) => {
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      const result = taskMap.get(task_id);
      if (result) {
        clearInterval(interval);
        taskMap.delete(task_id);
        resolve(result);
      }
    }, 1000);
    setTimeout(() => {
      clearInterval(interval);
      reject(new Error("Timeout waiting for task result"));
    }, timeout);
  });
};

module.exports = {
  startTrunstileServer,
  waitForTurnstileTaskResult,
};
