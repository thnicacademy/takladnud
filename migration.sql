-- =====================================================================
-- ตากหลาดนัด — Migration ฐานข้อมูล (MariaDB 10.5+)
-- ---------------------------------------------------------------------
-- สร้างตารางทั้งหมดตาม spec.md และใส่ข้อมูลตั้งต้น (ตลาด แผง รอบตลาด)
-- รันซ้ำได้อย่างปลอดภัย: ใช้ CREATE TABLE IF NOT EXISTS และใส่ข้อมูลตั้งต้น
-- เฉพาะเมื่อยังไม่มีตลาดในฐานข้อมูลเท่านั้น
--
-- วิธีใช้:  mysql -h <host> -u <user> -p <database> < migration.sql
--
-- หมายเหตุ: schema นี้ต้องตรงกับ initializeDatabase() ใน server.js
--           หากแก้โครงสร้างตาราง ให้แก้ทั้งสองที่
-- =====================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 1. users — บัญชีผู้ใช้ฝั่ง Shop (login ด้วยอีเมล; phone เป็นข้อมูลติดต่อ)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 2. shops — ข้อมูลร้านค้า (หนึ่งบัญชีหนึ่งร้าน)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shops (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  shop_name VARCHAR(150) NOT NULL,
  category VARCHAR(100) NULL,
  description TEXT NULL,
  contact_phone VARCHAR(20) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shops_user (user_id),
  INDEX idx_shops_category (category),
  CONSTRAINT fk_shops_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 3. markets — ตลาด
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS markets (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  market_name VARCHAR(150) NOT NULL,
  address VARCHAR(500) NULL,
  open_time TIME NULL,
  close_time TIME NULL,
  description TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 4. market_events — รอบ/วันที่จัดตลาด
--    status: scheduled | open | closed | cancelled
--    open_time/close_time เป็น NULL ได้ เพื่อใช้เวลาของตลาดแทน
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_events (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  market_id INT UNSIGNED NOT NULL,
  event_name VARCHAR(150) NOT NULL,
  event_date DATE NOT NULL,
  open_time TIME NULL,
  close_time TIME NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_events_market_date (market_id, event_date),
  CONSTRAINT fk_events_market FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 5. booths — แผงขาย
--    map_x/map_y = ตำแหน่งบนผังเป็นสัดส่วน 0–100
--    status: available | unavailable | maintenance
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS booths (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  market_id INT UNSIGNED NOT NULL,
  booth_code VARCHAR(30) NOT NULL,
  map_x DECIMAL(8,3) NULL,
  map_y DECIMAL(8,3) NULL,
  width DECIMAL(6,2) NULL,
  depth DECIMAL(6,2) NULL,
  base_price DECIMAL(10,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'available',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_booths_market_code (market_id, booth_code),
  INDEX idx_booths_market_status (market_id, status),
  CONSTRAINT fk_booths_market FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 6. bookings — การจองแผง
--    status: pending | confirmed | cancelled | rejected
--    active_slot มีค่าเฉพาะการจองที่ยัง pending/confirmed (นอกนั้น NULL)
--    unique key บนคอลัมน์นี้จึงกันการจอง active ซ้อนกันในแผง/รอบเดียวกัน
--    (ใช้แทน partial unique index ซึ่ง MariaDB ไม่รองรับ)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id INT UNSIGNED NOT NULL,
  booth_id INT UNSIGNED NOT NULL,
  shop_id INT UNSIGNED NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
  price_at_booking DECIMAL(10,2) NOT NULL,
  booked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  active_slot VARCHAR(30) AS (CASE WHEN status IN ('pending', 'confirmed') THEN CONCAT(event_id, ':', booth_id) END) PERSISTENT,
  INDEX idx_bookings_shop_status (shop_id, status),
  INDEX idx_bookings_event_booth_status (event_id, booth_id, status),
  UNIQUE KEY uq_bookings_active_slot (active_slot),
  CONSTRAINT fk_bookings_event FOREIGN KEY (event_id) REFERENCES market_events(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_bookings_booth FOREIGN KEY (booth_id) REFERENCES booths(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_bookings_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- ข้อมูลตั้งต้น (ตัวอย่าง — เจ้าของโครงการควรแก้เป็นข้อมูลตลาดจริง)
-- ใส่เฉพาะเมื่อยังไม่มีตลาดในฐานข้อมูล เวลาบันทึกเป็น UTC เหมือน server.js
-- =====================================================================
START TRANSACTION;

SET @seed := (SELECT COUNT(*) = 0 FROM markets);
SET @now := UTC_TIMESTAMP();

INSERT INTO markets (market_name, address, open_time, close_time, description, is_active, created_at, updated_at)
SELECT 'ตลาดนัดสวนกลาง', 'ลานกิจกรรมชุมชน ถนนตัวอย่าง', '09:00:00', '16:00:00',
       'ตลาดนัดชุมชนทุกวันเสาร์ รวมผักสด อาหาร ขนม และงานฝีมือจากคนในชุมชน', 1, @now, @now
FROM DUAL WHERE @seed;

SET @market_id := IF(@seed, LAST_INSERT_ID(), NULL);

-- แผง 24 แผง: โซน A/B แถวด้านใน, โซน C/D แถวใกล้ทางเข้า; D06 ปิดปรับปรุง
INSERT INTO booths (market_id, booth_code, map_x, map_y, width, depth, base_price, status, created_at, updated_at)
SELECT @market_id, t.booth_code, t.map_x, t.map_y, t.width, t.depth, t.base_price, t.status, @now, @now
FROM (
  SELECT 'A01' AS booth_code, 10 AS map_x, 16 AS map_y, 2 AS width, 2 AS depth, 150 AS base_price, 'available' AS status
  UNION ALL SELECT 'A02', 24, 16, 2, 2, 150, 'available'
  UNION ALL SELECT 'A03', 38, 16, 2, 2, 150, 'available'
  UNION ALL SELECT 'A04', 10, 33, 2, 2, 150, 'available'
  UNION ALL SELECT 'A05', 24, 33, 2, 2, 150, 'available'
  UNION ALL SELECT 'A06', 38, 33, 2, 2, 150, 'available'
  UNION ALL SELECT 'B01', 62, 16, 2, 2, 150, 'available'
  UNION ALL SELECT 'B02', 76, 16, 2, 2, 150, 'available'
  UNION ALL SELECT 'B03', 90, 16, 2, 2, 150, 'available'
  UNION ALL SELECT 'B04', 62, 33, 2, 2, 150, 'available'
  UNION ALL SELECT 'B05', 76, 33, 2, 2, 150, 'available'
  UNION ALL SELECT 'B06', 90, 33, 2, 2, 150, 'available'
  UNION ALL SELECT 'C01', 10, 67, 2, 2, 120, 'available'
  UNION ALL SELECT 'C02', 24, 67, 2, 2, 120, 'available'
  UNION ALL SELECT 'C03', 38, 67, 2, 2, 120, 'available'
  UNION ALL SELECT 'C04', 10, 84, 2, 2, 120, 'available'
  UNION ALL SELECT 'C05', 24, 84, 2, 2, 120, 'available'
  UNION ALL SELECT 'C06', 38, 84, 2, 2, 120, 'available'
  UNION ALL SELECT 'D01', 62, 67, 3, 2, 200, 'available'
  UNION ALL SELECT 'D02', 76, 67, 3, 2, 200, 'available'
  UNION ALL SELECT 'D03', 90, 67, 3, 2, 200, 'available'
  UNION ALL SELECT 'D04', 62, 84, 3, 2, 200, 'available'
  UNION ALL SELECT 'D05', 76, 84, 3, 2, 200, 'available'
  UNION ALL SELECT 'D06', 90, 84, 3, 2, 200, 'maintenance'
) AS t
WHERE @seed;

-- รอบตลาดวันเสาร์ 8 สัปดาห์ (เวลาเปิด–ปิดใช้ของตลาด)
INSERT INTO market_events (market_id, event_name, event_date, open_time, close_time, status, created_at)
SELECT @market_id, 'ตลาดนัดวันเสาร์', t.event_date, NULL, NULL, 'scheduled', @now
FROM (
  SELECT DATE('2026-10-31') AS event_date
  UNION ALL SELECT '2026-11-07'
  UNION ALL SELECT '2026-11-14'
  UNION ALL SELECT '2026-11-21'
  UNION ALL SELECT '2026-11-28'
  UNION ALL SELECT '2026-12-05'
  UNION ALL SELECT '2026-12-12'
  UNION ALL SELECT '2026-12-19'
) AS t
WHERE @seed;

COMMIT;
