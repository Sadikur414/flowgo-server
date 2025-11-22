const express = require('express');
const cors = require("cors");

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const app = express();
const admin = require("firebase-admin");
const port = process.env.PORT || 5000;

// ----------------------Middleware----------------------
app.use(cors());
app.use(express.json());

const serviceAccount = require("./firebase_admin_key.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


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

    const db = client.db("parcelDB");
    const parcelCollection = db.collection("parcels");
    const paymentCollection = db.collection("payments");
    const usersCollection = db.collection("users");
    const ridersCollection = db.collection("riders");

    //---------------------Custom Middleware------------------
    const verifyFBToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(404).send({ message: "Unauthorized access" });
      };
      const token = authHeader.split(" ")[1];
      if (!token) {
        return res.status(404).send({ message: "Unauthorized access" });
      }

      //Verify the token
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      }
      catch (error) {
        return res.status(403).send({ message: "Forbidden access" });
      }
    }

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "Forbidden access" });
      }
      next();
    }

    //-------------------------- Save User info id Database------------------------
    app.post("/users", async (req, res) => {
      try {
        const { email, role, created_at, last_login } = req.body;

        if (!email) {
          return res.status(400).json({ success: false, message: "Email is required" });
        }

        // Check if email already exists
        const existingUser = await usersCollection.findOne({ email });

        if (existingUser) {
          return res.status(409).json({
            success: false,
            message: "Email already exists",
          });
        }

        // Create user object
        const newUser = {
          email,
          role,
          created_at,
          last_login,
        };

        // Insert user
        const result = await usersCollection.insertOne(newUser);
        res.status(201).json({
          success: true,
          message: "User inserted successfully",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("Error saving user:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
      }
    })

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
    // ---------------- POST API: Be a rider ----------------
    app.post("/riders", async (req, res) => {
      const riderData = req.body;
      const result = await ridersCollection.insertOne(riderData);
      res.send(result)
    });

    // --------------------------- Create Payment Intent-----------------------
    app.post("/create-payment-intent", async (req, res) => {
      try {
        const { amountInCent } = req.body;

        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCent,
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // ---------------------- SAVE PAYMENT INFO ------------------------
    app.post("/payments", async (req, res) => {
      try {
        const { email, transactionId, amount, parcelId, paymentMethod } = req.body;

        if (!email || !transactionId || !amount) {
          return res.status(400).send({ success: false, message: "Missing payment fields" });
        }

        // Save payment in payments collection
        const paymentData = {
          email,
          parcelId,
          amount,
          transactionId,
          paymentMethod,
          payment_status: "paid", // mark as paid
          date: new Date()
        };
        const paymentResult = await paymentCollection.insertOne(paymentData);

        // Update the parcel's payment_status
        const parcelResult = await parcelCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          { $set: { payment_status: "paid" } }  // update status
        );

        res.send({
          success: true,
          message: "Payment saved and parcel updated successfully",
          paymentId: paymentResult.insertedId,
          parcelModifiedCount: parcelResult.modifiedCount
        });

      } catch (error) {
        console.error("Failed to save payment or update parcel:", error);
        res.status(500).send({ success: false, message: "Failed to process payment" });
      }
    });

    //******************** Riders Related Apis ******************* */
    // ---------------- GET API: Fetch all pending riders ----------------
    app.get("/riders/pending", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const pendingRiders = await ridersCollection
          .find({ status: "pending" })
          .sort({ submittedAt: -1 }) // newest first
          .toArray();

        res.send(pendingRiders);
      } catch (error) {
        console.error("Failed to fetch pending riders:", error);
        res.status(500).send({ success: false, message: "Failed to fetch pending riders" });
      }
    });


    // ---------------- GET API: Fetch all active riders ----------------
    app.get("/riders/active", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const activeRiders = await ridersCollection
          .find({ status: "active" })
          .sort({ submittedAt: -1 }) // newest first
          .toArray();

        res.send(activeRiders)
      } catch (error) {
        console.error("Failed to fetch active riders:", error);
        res.status(500).send({ success: false, message: "Failed to fetch active riders" });
      }
    });

    // ---------------- PATCH API: Update Rider Status ----------------
    app.patch("/riders/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      const { id } = req.params;
      const { status, email } = req.body;

      if (!id || !status) {
        return res
          .status(400)
          .send({ success: false, message: "Rider ID and status are required" });
      }

      // Only allow specific status values
      const validStatus = ["pending", "active", "rejected"];
      if (!validStatus.includes(status)) {
        return res
          .status(400)
          .send({ success: false, message: "Invalid status value" });
      }

      if (status === "active") {
        const userQuery = { email };
        const udateRole = {
          $set: {
            role: "rider"
          }
        }
        await usersCollection.updateOne(userQuery, udateRole);
      }

      try {
        const result = await ridersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );

        if (result.modifiedCount === 0) {
          return res
            .status(404)
            .send({ success: false, message: "Rider not found or status unchanged" });
        }

        res.send({ success: true, message: `Rider status updated to ${status}` });
      } catch (error) {
        console.error("Failed to update rider status:", error);
        res.status(500).send({ success: false, message: "Internal server error" });
      }
    });




    // ---------------- GET API: Fetch active riders by matching  district ----------------
    app.get("/riders/by-district", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const { district } = req.query;

        if (!district) {
          return res.status(400).send({
            success: false,
            message: "District is required",
          });
        }

        const riders = await ridersCollection
          .find({
            status: "active",
            district: district,   // district must match
          })
          .sort({ submittedAt: -1 })
          .toArray();

        res.send({
          success: true,
          count: riders.length,
          riders,
        });

      } catch (error) {
        console.error("Failed to fetch riders by district:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch active riders by district",
        });
      }
    });

    // ---------------- PATCH API: Assign a rider to a parcel ----------------
    app.patch("/parcels/assign/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      const parcelId = req.params.id;
      const { riderId, riderName, riderContact} = req.body;

      if (!parcelId || !riderId) {
        return res.status(400).send({ success: false, message: "Parcel ID and Rider ID are required" });
      }

      try {
        const updateData = {
          delivery_status: "in_transit",
          assignedAt: new Date(),
          assignRider_id: riderId,
          assignRider_name: riderName,
          riderContact,

        };

        const result = await parcelCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          { $set: updateData }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).send({ success: false, message: "Parcel not found or already assigned" });
        }

        res.send({ success: true, message: "Rider assigned successfully", updatedParcel: updateData });
      } catch (error) {
        console.error("Failed to assign rider:", error);
        res.status(500).send({ success: false, message: "Internal server error" });
      }
    });





    // ---------------- SEARCH USERS (Partial Email Search) ----------------
    app.get("/users/search", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const queryText = req.query.query;

        if (!queryText) {
          return res.status(400).send({ success: false, message: "Search query is required" });
        }

        const users = await usersCollection
          .find({
            email: { $regex: queryText, $options: "i" }
          })
          .limit(10)
          .toArray();

        res.send({ success: true, users });
      } catch (error) {
        console.error("User search failed:", error);
        res.status(500).send({ success: false, message: "Failed to search users" });
      }
    });

    // ---------------- MAKE USER ADMIN ----------------
    app.patch("/users/make-admin/:email", verifyFBToken, verifyAdmin, async (req, res) => {
      const email = req.params.email;

      if (!email) {
        return res.status(400).send({ success: false, message: "Email is required" });
      }

      try {
        const result = await usersCollection.updateOne(
          { email },
          { $set: { role: "admin" } }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).send({ success: false, message: "User not found or already admin" });
        }

        res.send({ success: true, message: `${email} is now an admin` });
      } catch (error) {
        console.error("Failed to make admin:", error);
        res.status(500).send({ success: false, message: "Failed to update user role" });
      }
    });

    // ---------------- REMOVE USER ADMIN ----------------
    app.patch("/users/remove-admin/:email", verifyFBToken, verifyAdmin, async (req, res) => {
      const email = req.params.email;

      if (!email) {
        return res.status(400).send({ success: false, message: "Email is required" });
      }

      try {
        const result = await usersCollection.updateOne(
          { email },
          { $set: { role: "user" } } // change role back to normal user
        );

        if (result.modifiedCount === 0) {
          return res
            .status(404)
            .send({ success: false, message: "User not found or already not an admin" });
        }

        res.send({ success: true, message: `${email} is no longer an admin` });
      } catch (error) {
        console.error("Failed to remove admin:", error);
        res.status(500).send({ success: false, message: "Failed to update user role" });
      }
    });

    // ---------------- GET USER ROLE BY EMAIL ----------------
    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;

      if (!email) {
        return res.status(400).send({ success: false, message: "Email is required" });
      }

      try {
        const user = await usersCollection.findOne({ email }, { projection: { role: 1, _id: 0 } });

        if (!user) {
          return res.status(404).send({ success: false, message: "User not found" });
        }

        res.send({ success: true, role: user.role });
      } catch (error) {
        console.error("Failed to get user role:", error);
        res.status(500).send({ success: false, message: "Failed to fetch user role" });
      }
    });



    // ---------------------- GET USER PAYMENT HISTORY ------------------------
    app.get("/payments", verifyFBToken, async (req, res) => {
      try {
        const userEmail = req.query.email;
        console.log(userEmail);
        console.log("Decoded email", req.decoded)
        if (req.decoded.email !== userEmail) {
          return res.status(403).send({ message: "Forbidden access" });
        }
        if (!userEmail) return res.status(400).send({ success: false, message: "Email is required in query!" });
        const query = { email: userEmail };
        const payments = await paymentCollection.find(query).sort({ date: -1 }).toArray();

        res.send(payments);
      } catch (error) {
        console.error("Failed to get payments:", error);
        res.status(500).send({ success: false, message: "Failed to fetch payments" });
      }
    });


    // ------------------ GET API: Fetch all parcels by email query ------------------
    app.get("/parcels", verifyFBToken, async (req, res) => {
      const { email, payment_status, delivery_status } = req.query;

      // if (!email) {
      //   return res.status(400).send({ success: false, message: "Email is required" });
      // }
      let query = {};
      if (email) {
        query.user_email = email
      }
      if (payment_status) {
        query.payment_status = payment_status
      }
      if (delivery_status) {
        query.delivery_status = delivery_status
      }

      try {

        // Fetch and sort parcels by latest creation_date
        const parcels = await parcelCollection
          .find(query)
          .sort({ creation_date: -1 }) // 
          .toArray();

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
    // ---------------- GET API: Fetch a single parcel by ID ----------------
    app.get("/parcels/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      if (!id) {
        return res.status(400).send({ success: false, message: "Parcel ID is required" });
      }
      try {
        const parcel = await parcelCollection.findOne({ _id: new ObjectId(id) });
        if (!parcel) {
          return res.status(404).send({ success: false, message: "Parcel not found" });
        }
        res.send(parcel);
      } catch (error) {
        console.error("Failed to fetch parcel:", error);
        res.status(500).send({ success: false, message: "Failed to fetch parcel" });
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
