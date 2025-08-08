// backend/models/ticketModel.js
const mongoose = require("mongoose");

const ticketSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  priority: { type: String, required: true },
  category: { type: String },
  dueDate: { type: String },
  attachments: { type: String }, // à améliorer plus tard
  createdAt: { type: Date, default: Date.now }, // auto-ajouté
});

module.exports = mongoose.model("Ticket", ticketSchema);
