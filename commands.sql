CREATE TABLE products (
    idSku TEXT PRIMARY KEY,       
    name TEXT NOT NULL,           
    url TEXT NOT NULL,            
    prevPrice REAL    
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