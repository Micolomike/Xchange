// backend/routes/ticketRoutes.js
const express = require("express");
const Ticket = require("../models/ticketModel");

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const ticket = new Ticket(req.body);
    const saved = await ticket.save();
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ error: "Erreur lors de la création du ticket." });
  }
});

router.get("/", async (req, res) => {
  const tickets = await Ticket.find().sort({ createdAt: -1 });
  res.json(tickets);
});

module.exports = router;
