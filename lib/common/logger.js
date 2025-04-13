const winston = require("winston");

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: "capsolver-worker" },
  transports: [
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),
  ],
});
logger.add(
  new winston.transports.Console({
    format: winston.format.printf(({ level, message, timestamp }) => {
      const fixedLengthTimestamp = timestamp.padEnd(24, " ");
      const fixedLengthLevel = level
        .toUpperCase()
        .padStart((6 + level.length) / 2, " ")
        .padEnd(6, " ");
      return `${fixedLengthTimestamp} [${fixedLengthLevel}]: ${message}`;
    }),
  })
);

module.exports = { logger };
