const express = require("express");

const reportRouter = express.Router();


const {
  createResearch,
} = require("../controller/research.controller");


reportRouter.post("/research", createResearch);

module.exports = reportRouter;