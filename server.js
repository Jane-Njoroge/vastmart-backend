const express = require("express");
const cors = require("cors");
const pool = require("./db");
const app = express();

app.use(cors());
app.use(express.json()); // Parse JSON bodies

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
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/products", async (req, res) => {
  const { name, description, price, stock_quantity } = req.body;
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
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/orders", async (req, res) => {
  const userId = req.query.user_id; // Pass user_id as query param
  try {
    const result = await pool.query(
      "SELECT order_id, total_amount, status, created_at FROM orders WHERE user_id = $1",
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/orders", async (req, res) => {
  const { user_id, items } = req.body; // items: [{ product_id, quantity }]
  try {
    let totalAmount = 0;
    for (const item of items) {
      const product = await pool.query(
        "SELECT price FROM products WHERE product_id = $1",
        [item.product_id]
      );
      totalAmount += product.rows[0].price * item.quantity;
    }

    const orderResult = await pool.query(
      "INSERT INTO orders (user_id, total_amount) VALUES ($1, $2) RETURNING order_id",
      [user_id, totalAmount]
    );
    const orderId = orderResult.rows[0].order_id;

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
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
