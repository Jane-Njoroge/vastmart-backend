const express = require("express");
const cors = require("cors");
const pool = require("./db");
const app = express();

// Middleware
app.use(cors({ origin: "http://localhost:3000" })); // Restrict to React dev server
app.use(express.json()); // Parse JSON bodies

// Get all products
app.get("/products", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.product_id, p.name, p.price, p.currency, i.stock_quantity
      FROM products p
      LEFT JOIN inventory i ON p.product_id = i.product_id
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

// Add a new product
app.post("/products", async (req, res) => {
  const { name, description, price, stock_quantity } = req.body;
  if (!name || !price || !stock_quantity) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  try {
    const productResult = await pool.query(
      "INSERT INTO products (name, description, price) VALUES ($1, $2, $3) RETURNING product_id",
      [name, description, price]
    );
    const productId = productResult.rows[0].product_id;

    await pool.query(
      "INSERT INTO inventory (product_id, stock_quantity) VALUES ($1, $2)",
      [productId, stock_quantity]
    );

    res.status(201).json({ message: "Product added", product_id: productId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add product" });
  }
});

// Create or get user by email
app.post("/users", async (req, res) => {
  const { email } = req.body;
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: "Valid email is required" });
  }
  try {
    const userCheck = await pool.query(
      "SELECT user_id FROM users WHERE email = $1",
      [email]
    );
    if (userCheck.rows.length > 0) {
      return res.json({ user_id: userCheck.rows[0].user_id });
    }

    const userResult = await pool.query(
      "INSERT INTO users (email, username, created_at) VALUES ($1, $2, $3) RETURNING user_id",
      [email, email.split("@")[0], new Date()] // Default username as email prefix, timestamp
    );
    res.status(201).json({ user_id: userResult.rows[0].user_id });
  } catch (err) {
    console.error("Error inserting user:", err);
    res.status(500).json({ error: "Failed to process user" });
  }
});
// app.post("/users", async (req, res) => {
//   const { email } = req.body;
//   if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
//     return res.status(400).json({ error: "Valid email is required" });
//   }
//   try {
//     // Check if user exists
//     const userCheck = await pool.query(
//       "SELECT user_id FROM users WHERE email = $1",
//       [email]
//     );
//     if (userCheck.rows.length > 0) {
//       return res.json({ user_id: userCheck.rows[0].user_id });
//     }

//     // Create new user if not found
//     const userResult = await pool.query(
//       "INSERT INTO users (email) VALUES ($1) RETURNING user_id",
//       [email]
//     );
//     res.status(201).json({ user_id: userResult.rows[0].user_id });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Failed to process user" });
//   }
// });

// Get orders for a user
app.get("/orders", async (req, res) => {
  const userId = req.query.user_id;
  if (!userId) {
    return res.status(400).json({ error: "user_id is required" });
  }
  try {
    const result = await pool.query(
      "SELECT order_id, total_amount, status, created_at FROM orders WHERE user_id = $1",
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

// Create a new order
app.post("/orders", async (req, res) => {
  const { user_id, items } = req.body;
  if (!user_id || !items || !Array.isArray(items) || items.length === 0) {
    return res
      .status(400)
      .json({ error: "user_id and valid items array are required" });
  }

  try {
    // Validate items and calculate total
    let totalAmount = 0;
    for (const item of items) {
      if (!item.product_id || !item.quantity || item.quantity <= 0) {
        return res.status(400).json({
          error: "Each item must have a valid product_id and quantity",
        });
      }
      const product = await pool.query(
        "SELECT price FROM products WHERE product_id = $1",
        [item.product_id]
      );
      if (product.rows.length === 0) {
        return res
          .status(404)
          .json({ error: `Product ${item.product_id} not found` });
      }
      const stock = await pool.query(
        "SELECT stock_quantity FROM inventory WHERE product_id = $1",
        [item.product_id]
      );
      if (stock.rows[0].stock_quantity < item.quantity) {
        return res
          .status(400)
          .json({ error: `Insufficient stock for product ${item.product_id}` });
      }
      totalAmount += product.rows[0].price * item.quantity;
    }

    // Create order
    const orderResult = await pool.query(
      "INSERT INTO orders (user_id, total_amount) VALUES ($1, $2) RETURNING order_id",
      [user_id, totalAmount]
    );
    const orderId = orderResult.rows[0].order_id;

    // Add order items and update inventory
    for (const item of items) {
      const product = await pool.query(
        "SELECT price FROM products WHERE product_id = $1",
        [item.product_id]
      );
      await pool.query(
        "INSERT INTO order_items (order_id, product_id, quantity, price_at_time) VALUES ($1, $2, $3, $4)",
        [orderId, item.product_id, item.quantity, product.rows[0].price]
      );
      await pool.query(
        "UPDATE inventory SET stock_quantity = stock_quantity - $1 WHERE product_id = $2",
        [item.quantity, item.product_id]
      );
    }

    res.status(201).json({ message: "Order created", order_id: orderId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create order" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
