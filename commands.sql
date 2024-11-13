CREATE TABLE
  products (
    idSku TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    prevPrice REAL,
    scrapePriority INT DEFAULT 0;
  );

CREATE TABLE
  demo_product (
    pdt_sku INT PRIMARY KEY,
    pdt_simplesku INT,
    pdt_name TEXT NOT NULL,
    pdt_photo TEXT,
    pdt_price TEXT,
    -- no native boolean type, but 1 is considered TRUE & 0 is FALSE
    misc_isDiscounted INT,
    misc_discountedPrice TEXT
  );

CREATE TABLE
  users (
    id INTEGER PRIMARY KEY,
    first_name TEXT NOT NULL,
    username TEXT UNIQUE
  );

CREATE TABLE
  wishlist (
    idSku TEXT,
    user_id INTEGER,
    FOREIGN KEY (idSku) REFERENCES products (idSku),
    FOREIGN KEY (user_id) REFERENCES users (id)
  );

-- update priority when no. of users tracking a product increases
CREATE TRIGGER wishlist_insert_trigger
AFTER INSERT ON wishlist 
WHEN NOT EXISTS (
    SELECT 1 FROM wishlist
    WHERE idSku = NEW.idSku AND rowid < NEW.rowid
)
BEGIN
    UPDATE products
    SET scrapePriority = scrapePriority + 1
    WHERE idSku = NEW.idSku;
END;
