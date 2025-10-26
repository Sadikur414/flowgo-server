const express = require('express');
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
 
// MongoDB URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.s6ixckq.mongodb.net/?retryWrites=true&w=majority`;

// Create MongoClient
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();
    console.log("MongoDB connected successfully");

    const parcelCollection = client.db("parcelDB").collection("parcels");

    // ---------------- POST API: Add new parcel ----------------
    app.post("/parcels", async (req, res) => {
      const parcelData = req.body;
      console.log("Data received:", parcelData);

      // Basic validation
      if (!parcelData.name || !parcelData.type || !parcelData.senderRegion || !parcelData.receiverRegion) {
        return res.status(400).send({ success: false, message: "Missing required fields" });
      }

      try {
        const result = await parcelCollection.insertOne(parcelData);
        console.log("Insert result:", result);
        res.status(201).send({
          success: true,
          message: "Parcel added successfully!",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("MongoDB insert failed:", error);
        res.status(500).send({ success: false, message: "Failed to add parcel" });
      }
    });

    // ---------------- GET API: Fetch all parcels ----------------
    app.get("/parcels", async (req, res) => {
  const email = req.query.email;

  if (!email) {
    return res.status(400).send({ success: false, message: "Email is required" });
  }

  try {
    // Fetch and sort parcels by latest creation_date
    const parcels = await parcelCollection
      .find({ user_email: email })
      .sort({ creation_date: -1 }) // 🧠 This only works if stored as Date type
      .toArray();

    // If your creation_date is string (like now), do manual sort
    const sortedParcels = parcels.sort(
      (a, b) => new Date(b.creation_date) - new Date(a.creation_date)
    );

    res.send({
      success: true,
      count: sortedParcels.length,
      parcels: sortedParcels,
    });

      } catch (error) {
        console.error("Failed to fetch parcels:", error);
        res.status(500).send({ success: false, message: "Failed to fetch parcels" });
      }
    });

      // ---------------- DELETE API: Delete a parcel ----------------
    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;

      if (!id) {
        return res.status(400).send({ success: false, message: "Parcel ID is required" });
      }

      try {
        const result = await parcelCollection.deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount > 0) {
          res.send({ success: true, message: "Parcel deleted successfully" });
        } else {
          res.status(404).send({ success: false, message: "Parcel not found" });
        }
      } catch (error) {
        console.error("Failed to delete parcel:", error);
        res.status(500).send({ success: false, message: "Failed to delete parcel" });
      }
    });

  } catch (err) {
    console.error("MongoDB connection error:", err);
  }
}

run().catch(console.dir);

// Basic route
app.get("/", (req, res) => {
  res.send("Parcel server is running...");
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
