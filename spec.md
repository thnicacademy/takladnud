# ตากหลาดนัด

## แนวคิดแอป

แอป **ตากหลาดนัด** ช่วยให้การจัดการแผงร้านค้าในตลาดเป็นระบบ และช่วยให้ลูกค้าวางแผนเลือกซื้อสินค้าจากแผนผังตลาดได้สะดวก

## ข้อตกลงที่ยืนยันสำหรับเวอร์ชันแรก

- มีตลาดเดียว โดยเจ้าของโครงการเป็นผู้กำหนดและเตรียมข้อมูลตลาด รอบตลาด และแผงตั้งต้น
- ผังตลาดใช้พิกัด `x` และ `y` ของแผงในตาราง `booths` เพื่อวางตำแหน่งบนหน้าเว็บ ไม่ใช้ภาพผังเป็นข้อกำหนดบังคับ
- การจองที่ผ่านการตรวจสอบจะมีสถานะ `confirmed` ทันที ไม่มีขั้นตอนอนุมัติ Admin
- ผู้ค้าสามารถยกเลิกการจองได้ทุกเวลา โดยเปลี่ยนสถานะเป็น `cancelled` และเก็บประวัติไว้
- Shop ใช้อีเมลเข้าสู่ระบบ; เบอร์โทรเป็นข้อมูลติดต่อ ไม่ใช่ credential สำหรับ login
- เบอร์ติดต่อที่ร้านกรอกใน `contact_phone` และลิงก์ช่องทางติดตาม `social_url` เปิดเผยแก่ลูกค้าบนหน้าสาธารณะ; ชื่อผู้ติดต่อ `contact_name` ไม่เปิดเผย
- ผู้ดูแลตลาด (Admin) คือบัญชีที่มี `users.role = 'admin'`; ตั้งคนแรกด้วยคำสั่ง SQL หลังสมัครบัญชีปกติ (ดู `migration.sql`) ไม่มีหน้าสมัคร Admin
- ร้านจองแผงเดียวกันได้หลายรอบในคำขอเดียว (สูงสุด 12 รอบ) โดยแต่ละรอบตรวจสอบแยกกัน
- เวลาแสดงผลใช้เขตเวลา `Asia/Bangkok`

## กลุ่มผู้ใช้งานและความต้องการ

### 1. พ่อค้าแม่ค้า (Shop)
- เข้ามาจองแผงร้านค้าในตลาด
- ดูข้อมูลแผงและสถานะการจอง เพื่อช่วยจัดการพื้นที่ตลาดอย่างเป็นระเบียบ

### 2. ลูกค้า (Customer)
- สแกน QR Code เพื่อเปิดดูแผนผังร้านค้าในตลาด
- ใช้แผนผังวางแผนแวะอุดหนุนร้านค้าที่สนใจ

## ขอบเขตฟีเจอร์

### ฟีเจอร์สำหรับเวอร์ชันปัจจุบัน

- **Shop:** สมัครสมาชิกและเข้าสู่ระบบ
- **Shop:** ดูแผงที่ว่าง พร้อมตำแหน่งและรายละเอียด เช่น ขนาดหรือค่าเช่า
- **Shop:** จองแผงและตรวจสอบสถานะการจอง
- **Shop:** จัดการข้อมูลร้าน เช่น ชื่อร้าน ประเภทสินค้า และข้อมูลติดต่อ
- **Shop:** ยกเลิกการจองได้ทุกเวลา โดยเก็บประวัติรายการไว้
- **Customer:** สแกน QR Code เพื่อเปิดดูแผนผังตลาด
- **Customer:** ดูตำแหน่งและรายละเอียดร้านค้าบนแผนผัง
- **Customer:** ค้นหาหรือกรองร้านตามชื่อและประเภทสินค้า
- **Customer:** ดูวันและเวลาเปิดทำการของตลาด
- **Shop:** จองแผงเดียวกันหลายรอบในครั้งเดียว และปุ่ม “จองแผงเดิมอีกครั้ง” จากหน้าหลักร้าน
- **Shop:** อัปโหลดรูปหน้าร้าน (JPG/PNG/WEBP ระบบย่อขนาดให้) และระบุชื่อผู้ติดต่อ/ลิงก์ช่องทางติดตาม
- **Shop:** QR Code ประจำร้าน ลิงก์ไปหน้ารายละเอียดร้าน สำหรับพิมพ์ติดหน้าแผง
- **Customer:** “ร้านที่อยากแวะ” — บันทึกร้านไว้ในเบราว์เซอร์ ระบบเรียงลำดับเดินจากทางเข้าและวาดเส้นทางบนผัง
- **Customer:** ปุ่มนำทางไปตลาด (Google Maps) และปุ่มเลือกประเภทสินค้าแบบเร็ว

### ฟีเจอร์ผู้ดูแลตลาด (Admin)

เดิมบันทึกไว้เป็นงานอนาคต และเพิ่มเข้าขอบเขตแล้ว เพื่อให้ตลาดใช้งานได้ต่อเนื่องโดยไม่ต้องแก้ฐานข้อมูลเอง:
- แก้ไขข้อมูลตลาด (ชื่อ สถานที่ เวลาเปิด–ปิด คำอธิบาย การเปิดแสดง)
- เพิ่มรอบตลาดทีละรอบหรือทุกสัปดาห์ (1–26 สัปดาห์), แก้ไขรอบ, เปลี่ยนสถานะ; งดตลาด (`cancelled`) จะยกเลิกการจองที่ยังใช้งานของรอบนั้นอัตโนมัติ
- เพิ่ม/แก้ไขแผงและผัง: หมายเลข ขนาด ราคา สถานะ และวางตำแหน่งด้วยการแตะบนผัง
- ดูการจองทุกร้านตามรอบ/สถานะ/คำค้น พร้อมข้อมูลติดต่อร้าน; อนุมัติ (`pending`→`confirmed`), ปฏิเสธ (`rejected`) หรือยกเลิก (`cancelled`)
- ค้นหาร้าน ดูจำนวนการจอง และปิด/เปิดใช้งานบัญชีร้าน (ปิดแล้วออกจากระบบทันที)
- ยังไม่ทำ: การสร้างตลาดใหม่ (ตกลงมีตลาดเดียว), การลบข้อมูลที่มีประวัติ, การชำระเงิน และระบบแจ้งเตือน

## แนวทางออกแบบหน้าจอ

### ภาพรวมธีมและการใช้งาน

- ใช้ธีมธรรมชาติที่ให้ความรู้สึกอบอุ่น สงบ และเป็นมิตร ด้วยสีเขียวพาสเทล สีฟ้าอ่อน สีครีม และสีขาวนวล
- ใช้สีเข้มที่อ่านง่ายสำหรับข้อความและปุ่มสำคัญ หลีกเลี่ยงสีสดจัดและการใช้สีเป็นตัวสื่อความหมายเพียงอย่างเดียว
- ใช้ตัวอักษรภาษาไทยที่อ่านง่าย ขนาดเนื้อหาแนะนำอย่างน้อย 16 px และปุ่ม/พื้นที่กดมีขนาดใหญ่พอสำหรับมือถือ
- ใช้เลย์เอาต์ responsive รองรับมือถือ แท็บเล็ต และคอมพิวเตอร์ โดยจัดเมนูและเนื้อหาใหม่ตามขนาดหน้าจอ
- ใช้คำสั้น ชัดเจน ไอคอนมีป้ายกำกับ และแสดงสถานะการทำงานให้เข้าใจง่าย เหมาะกับผู้ใช้ช่วงอายุประมาณ 30-60 ปี
- ทุกหน้าควรมีชื่อหน้า ปุ่มกลับหรือเมนูหลักที่เห็นชัด และแจ้งเตือนเมื่อเกิดข้อผิดพลาดหรือทำรายการสำเร็จ

### หน้าสำหรับพ่อค้าแม่ค้า (Shop)

#### 1. หน้าเข้าสู่ระบบ / สมัครสมาชิก
- ชื่อแอปและคำอธิบายสั้น ๆ
- ช่องกรอกอีเมลและรหัสผ่าน
- ปุ่มเข้าสู่ระบบและลิงก์สมัครสมาชิก
- แบบฟอร์มสมัครสมาชิกประกอบด้วยอีเมล เบอร์โทรศัพท์สำหรับติดต่อ ชื่อร้าน และรหัสผ่าน
- แสดงข้อความแนะนำรูปแบบข้อมูลและข้อผิดพลาดใกล้ช่องกรอก

#### 2. หน้าหลักร้านค้า
- คำทักทายและชื่อร้าน
- สรุปสถานะการจอง เช่น ยังไม่มีการจอง รอตรวจสอบ หรือจองสำเร็จ
- ปุ่มหลัก “จองแผง”
- รายละเอียดแผงปัจจุบัน หากมี เช่น หมายเลขแผง วันที่จอง และข้อมูลตลาด
- เมนูไปยังข้อมูลร้าน การจอง และการออกจากระบบ

#### 3. หน้ารายการแผงและเลือกแผง
- ตัวกรองตลาด/วันจัดงาน และตัวกรองสถานะแผง
- รายการแผงแบบการ์ดที่อ่านง่าย แสดงหมายเลข ตำแหน่ง ขนาด ค่าเช่า และสถานะ
- สถานะใช้ข้อความและสีประกอบ เช่น “ว่าง” “ไม่ว่าง” โดยสีไม่ใช่ตัวบอกสถานะเพียงอย่างเดียว
- หากมีแผนผัง ให้สลับดูแบบรายการหรือแผนผัง และเลือกแผงจากทั้งสองรูปแบบได้
- ปุ่มเลือกแผงที่ว่าง พร้อมคำยืนยันก่อนส่งคำขอจอง

#### 4. หน้ารายละเอียดและยืนยันการจอง
- สรุปตลาด วันจัดงาน หมายเลขแผง ขนาด และค่าใช้จ่าย
- แสดงเงื่อนไขการจองและการยกเลิกอย่างชัดเจน
- ปุ่มยืนยันการจองและปุ่มกลับไปเลือกแผง
- แจ้งผลสำเร็จพร้อมสถานะและรายละเอียดที่จอง

#### 5. หน้าการจองของฉัน
- รายการและประวัติการจอง เรียงตามวันจัดงาน
- การ์ดแสดงตลาด วันจัดงาน หมายเลขแผง และสถานะ
- หน้ารายละเอียดการจอง พร้อมปุ่มยกเลิกเมื่อเข้าเงื่อนไข
- กล่องยืนยันก่อนยกเลิก และแจ้งผลหลังดำเนินการ

#### 6. หน้าโปรไฟล์และข้อมูลร้าน
- แสดงและแก้ไขชื่อร้าน ประเภทสินค้า ชื่อผู้ติดต่อ และเบอร์โทรศัพท์
- ปุ่มบันทึกที่เห็นชัด พร้อมแจ้งเมื่อบันทึกสำเร็จหรือมีข้อผิดพลาด

### หน้าสำหรับลูกค้า (Customer)

#### 1. หน้าแผนผังตลาดจาก QR Code
- ชื่อตลาด วันและเวลาเปิดทำการ พร้อมข้อมูลสถานที่
- แผนผังตลาดที่ย่อ/ขยายและเลื่อนได้บนมือถือ โดยยังอ่านหมายเลขแผงได้
- รายการร้านค้าหรือปุ่มสลับระหว่าง “แผนผัง” กับ “รายชื่อร้าน”
- ช่องค้นหาร้านและตัวกรองประเภทสินค้า
- คำอธิบายสัญลักษณ์และสถานะร้าน พร้อมข้อความเมื่อไม่มีผลลัพธ์

#### 2. หน้ารายละเอียดร้านค้า
- ชื่อร้าน ประเภทสินค้า และคำอธิบายสั้น ๆ
- หมายเลขแผงและตำแหน่งบนแผนผัง
- ข้อมูลติดต่อหรือช่องทางติดตาม หากร้านค้าระบุไว้
- ปุ่มกลับไปยังแผนผังหรือผลการค้นหา

### หน้าผู้ดูแลตลาด (Admin)

- เข้าจากเมนู “ผู้ดูแลตลาด” (แสดงเฉพาะบัญชี admin) มีแท็บ: ภาพรวม, รอบตลาด, แผงและผัง, การจอง, ร้านค้า, ข้อมูลตลาด
- ภาพรวม: จำนวนร้านที่ใช้งาน, รอบที่จะถึง, จำนวนแผงที่จองแล้วและค่าเช่ารอบถัดไป, คำเตือนเมื่อรอบตลาดเหลือน้อยกว่า 4 รอบ
- ทุกการกระทำที่ย้อนกลับยาก (งดตลาด ปฏิเสธ/ยกเลิกการจอง ปิดใช้งานร้าน) มีกล่องยืนยันก่อน

### แนวทางภาพและแบรนด์

- โลโก้ `public/images/logo.svg` (แผงหลังคาลายทางรวมกับหมุดแผนที่) ใช้ที่ header, footer, หน้าเข้าสู่ระบบ และ favicon — เปลี่ยนโลโก้ได้ด้วยการแทนที่ไฟล์นี้
- ภาพประกอบใน `public/images/`: `hero-market.svg`, `empty-shops.svg`, `empty-bookings.svg`, `shop-placeholder.svg` (ใช้แทนรูปร้านที่ยังไม่อัปโหลด), `pattern-awning.svg` (แถบลายหลังคาตกแต่ง)
- รูปร้านที่อัปโหลดเก็บใน `public/images/shops/` และเรียกด้วย URL `/images/shops/<ไฟล์>`
- ธีมพาสเทล: ครีม `#FBF8F1`, มินต์ `#CDE8D6`, ฟ้า `#CFE6F2`, ลาเวนเดอร์ `#E3DDF5`, พีช `#FBD9C9`, เนย `#FCEFC7` กับสีหลักเขียวเข้ม `#2D5A48`; หัวข้อใช้ฟอนต์ Prompt เนื้อหาใช้ IBM Plex Sans Thai

## แบบฐานข้อมูลเบื้องต้น (MariaDB)

ออกแบบฐานข้อมูลให้รองรับผู้ค้า การจัดตลาดเป็นรอบ แผงขาย การจอง และข้อมูลร้านที่ลูกค้าดูได้จาก QR Code โดยข้อมูลตลาด/แผงตั้งต้นอาจถูกจัดเตรียมไว้ให้ก่อน เนื่องจากฟีเจอร์ Admin ยังไม่อยู่ในขอบเขตเวอร์ชันแรก

### หลักการและชนิดข้อมูล

- ใช้ `InnoDB` เพื่อรองรับ foreign key และธุรกรรม
- ใช้ `utf8mb4` เพื่อรองรับภาษาไทยและอักขระพิเศษ
- คีย์หลักใช้ `INT UNSIGNED AUTO_INCREMENT` สำหรับความเรียบง่าย
- วันเวลาใช้ `DATETIME`; วันที่อย่างเดียวใช้ `DATE`; เวลาเปิดปิดใช้ `TIME`
- เงินใช้ `DECIMAL(10,2)` ห้ามใช้ `FLOAT` เพราะอาจมีความคลาดเคลื่อน
- สถานะใช้ `VARCHAR` พร้อมข้อกำหนดค่าที่อนุญาตในแอป เพื่อปรับขยายได้ง่าย
- รหัสผ่านเก็บเฉพาะ hash ที่สร้างด้วยไลบรารีที่เหมาะสม ห้ามเก็บรหัสผ่านจริง

### 1. `users` — บัญชีผู้ใช้ฝั่ง Shop

| คอลัมน์ | ชนิดข้อมูล | รายละเอียด |
|---|---|---|
| `id` | `INT UNSIGNED` | Primary key, auto increment |
| `email` | `VARCHAR(255)` | อีเมลสำหรับเข้าสู่ระบบ, required และ unique |
| `phone` | `VARCHAR(20)` | เบอร์โทรศัพท์บัญชี/ติดต่อ, เก็บเป็นข้อความเพื่อรักษาเลข 0 นำหน้า, nullable |
| `password_hash` | `VARCHAR(255)` | password hash เท่านั้น |
| `role` | `VARCHAR(20)` | `shop` (ค่าเริ่มต้น) หรือ `admin` |
| `created_at` | `DATETIME` | วันเวลาสร้างบัญชี, default เวลาปัจจุบัน |
| `updated_at` | `DATETIME` | วันเวลาแก้ไขล่าสุด |
| `is_active` | `TINYINT(1)` | 1 ใช้งาน, 0 ปิดใช้งาน |

กำหนดให้ `email` เป็นข้อมูลล็อกอินที่จำเป็นและไม่ซ้ำกัน; `phone` เป็นข้อมูลติดต่อเสริมและตรวจสอบความซ้ำซ้อนเมื่อมีค่า

### 2. `shops` — ข้อมูลร้านค้า

| คอลัมน์ | ชนิดข้อมูล | รายละเอียด |
|---|---|---|
| `id` | `INT UNSIGNED` | Primary key, auto increment |
| `user_id` | `INT UNSIGNED` | Foreign key ไป `users.id`; หนึ่งบัญชีมีร้านหลักหนึ่งร้านในเวอร์ชันแรก |
| `shop_name` | `VARCHAR(150)` | ชื่อร้าน, required |
| `category` | `VARCHAR(100)` | ประเภทสินค้า เช่น อาหาร เสื้อผ้า งานฝีมือ |
| `description` | `TEXT` | รายละเอียดร้าน, nullable |
| `contact_name` | `VARCHAR(100)` | ชื่อผู้ติดต่อ สำหรับผู้ดูแลตลาด ไม่แสดงแก่ลูกค้า, nullable |
| `contact_phone` | `VARCHAR(20)` | เบอร์ติดต่อที่แสดงแก่ลูกค้า, nullable |
| `social_url` | `VARCHAR(255)` | ลิงก์ช่องทางติดตาม (http/https เท่านั้น) แสดงแก่ลูกค้า, nullable |
| `image_url` | `VARCHAR(255)` | path รูปร้าน `/images/shops/...`, nullable |
| `created_at` | `DATETIME` | วันเวลาสร้างข้อมูล |
| `updated_at` | `DATETIME` | วันเวลาแก้ไขล่าสุด |

สร้าง unique index ที่ `user_id` หากกำหนดหนึ่งร้านต่อหนึ่งบัญชี และทำ index ที่ `category` สำหรับค้นหา/กรองร้าน

### 3. `markets` — ตลาด

| คอลัมน์ | ชนิดข้อมูล | รายละเอียด |
|---|---|---|
| `id` | `INT UNSIGNED` | Primary key, auto increment |
| `market_name` | `VARCHAR(150)` | ชื่อตลาด |
| `address` | `VARCHAR(500)` | ที่อยู่หรือคำอธิบายสถานที่ |
| `open_time` | `TIME` | เวลาเปิดโดยทั่วไป, nullable |
| `close_time` | `TIME` | เวลาปิดโดยทั่วไป, nullable |
| `description` | `TEXT` | ข้อมูลเพิ่มเติม, nullable |
| `is_active` | `TINYINT(1)` | เปิดให้แสดงผลหรือไม่ |
| `created_at` | `DATETIME` | วันเวลาสร้างข้อมูล |
| `updated_at` | `DATETIME` | วันเวลาแก้ไขล่าสุด |

### 4. `market_events` — รอบ/วันที่จัดตลาด

ใช้แยกวันจัดตลาดออกจากข้อมูลตลาด เพื่อรองรับตลาดที่จัดหลายวันหรือเปิดเป็นรอบ

| คอลัมน์ | ชนิดข้อมูล | รายละเอียด |
|---|---|---|
| `id` | `INT UNSIGNED` | Primary key, auto increment |
| `market_id` | `INT UNSIGNED` | Foreign key ไป `markets.id` |
| `event_name` | `VARCHAR(150)` | ชื่อรอบ เช่น ตลาดนัดวันเสาร์ |
| `event_date` | `DATE` | วันที่จัดตลาด |
| `open_time` | `TIME` | เวลาเปิดรอบนี้, nullable เพื่อใช้เวลาเริ่มต้นจากตลาด |
| `close_time` | `TIME` | เวลาปิดรอบนี้, nullable |
| `status` | `VARCHAR(20)` | `scheduled`, `open`, `closed` หรือ `cancelled` |
| `created_at` | `DATETIME` | วันเวลาสร้างข้อมูล |

เพิ่ม index `(market_id, event_date)` สำหรับค้นหารอบตลาดตามวัน

### 5. `booths` — แผงขาย

| คอลัมน์ | ชนิดข้อมูล | รายละเอียด |
|---|---|---|
| `id` | `INT UNSIGNED` | Primary key, auto increment |
| `market_id` | `INT UNSIGNED` | Foreign key ไป `markets.id` |
| `booth_code` | `VARCHAR(30)` | หมายเลขแผง เช่น A01, unique ภายในตลาด |
| `map_x` | `DECIMAL(8,3)` | ตำแหน่งแนวนอนบนผังแบบสัดส่วน, nullable |
| `map_y` | `DECIMAL(8,3)` | ตำแหน่งแนวตั้งบนผังแบบสัดส่วน, nullable |
| `width` | `DECIMAL(6,2)` | ความกว้าง หน่วยเมตร, nullable |
| `depth` | `DECIMAL(6,2)` | ความลึก หน่วยเมตร, nullable |
| `base_price` | `DECIMAL(10,2)` | ค่าเช่ามาตรฐานต่อรอบ |
| `status` | `VARCHAR(20)` | `available`, `unavailable` หรือ `maintenance` |
| `created_at` | `DATETIME` | วันเวลาสร้างข้อมูล |
| `updated_at` | `DATETIME` | วันเวลาแก้ไขล่าสุด |

กำหนด unique index `(market_id, booth_code)` และ index `(market_id, status)`; พิกัดเป็นค่าตัวเลขสัดส่วนที่ frontend แปลงตามขนาดผัง

### 6. `bookings` — การจองแผง

| คอลัมน์ | ชนิดข้อมูล | รายละเอียด |
|---|---|---|
| `id` | `INT UNSIGNED` | Primary key, auto increment |
| `event_id` | `INT UNSIGNED` | Foreign key ไป `market_events.id` |
| `booth_id` | `INT UNSIGNED` | Foreign key ไป `booths.id` |
| `shop_id` | `INT UNSIGNED` | Foreign key ไป `shops.id` |
| `status` | `VARCHAR(20)` | `pending`, `confirmed`, `cancelled` หรือ `rejected` |
| `price_at_booking` | `DECIMAL(10,2)` | ราคาที่ตกลง ณ เวลาจอง เก็บ snapshot แม้ราคาแผงเปลี่ยนภายหลัง |
| `booked_at` | `DATETIME` | วันเวลาส่งคำขอจอง |
| `cancelled_at` | `DATETIME` | วันเวลายกเลิก, nullable |
| `created_at` | `DATETIME` | วันเวลาสร้างรายการ |
| `updated_at` | `DATETIME` | วันเวลาแก้ไขล่าสุด |

เพิ่ม foreign key ไปยังสามตารางที่อ้างถึง และ index `(shop_id, status)`, `(event_id, booth_id, status)` สำหรับตรวจรายการและสถานะ ห้ามมีการจอง `pending` หรือ `confirmed` ซ้ำสำหรับแผงเดียวกันในรอบเดียวกัน การตรวจและสร้างการจองต้องทำใน transaction พร้อมล็อกแถว/ตรวจซ้ำฝั่งเซิร์ฟเวอร์ เพื่อป้องกันผู้ใช้สองคนจองพร้อมกัน และมีคอลัมน์ generated `active_slot` (= `event_id:booth_id` เฉพาะสถานะ pending/confirmed) พร้อม unique key เป็นด่านสุดท้ายระดับฐานข้อมูล

### ความสัมพันธ์หลัก

- `users` 1:1 `shops` ในเวอร์ชันแรก
- `markets` 1:N `market_events`
- `markets` 1:N `booths`
- `market_events` 1:N `bookings`
- `booths` 1:N `bookings` ตามรอบตลาด
- `shops` 1:N `bookings`

### แนวทางลบและความถูกต้องของข้อมูล

- ใช้ `ON DELETE RESTRICT` กับข้อมูลที่มีประวัติการจอง เพื่อป้องกันการลบข้อมูลย้อนหลังโดยไม่ตั้งใจ
- ใช้การปิดใช้งาน (`is_active`) หรือเปลี่ยนสถานะ แทนการลบบัญชี ตลาด หรือแผงที่มีรายการจอง
- การยกเลิกการจองให้เปลี่ยน `status` และบันทึก `cancelled_at`; ไม่ลบแถวการจอง
- ตรวจสอบว่ารอบตลาดและแผงอยู่ใน `market_id` เดียวกันก่อนสร้างการจอง
- QR Code เก็บเป็น URL ที่ชี้ไปยังหน้าแผนผังตลาด ไม่จำเป็นต้องเก็บรูป QR ในฐานข้อมูล; หน้าแผนผังค้นข้อมูลตลาดและร้านจากฐานข้อมูล
- ขอบเขตฐานข้อมูลนี้ยังไม่รวมตาราง Admin, การชำระเงิน, การคืนเงิน หรือระบบแจ้งเตือน ซึ่งพิจารณาเพิ่มภายหลัง

## แนวทางออกแบบ API

### ข้อตกลงทั่วไป

- รูปแบบ API: REST, ใช้ JSON ทั้ง request และ response
- Base path: `/api/v1`
- ใช้ HTTPS ในระบบที่เผยแพร่จริง และส่ง `Content-Type: application/json; charset=utf-8`
- เวลา API ส่งกลับเป็น ISO 8601 เช่น `2026-10-31T10:30:00Z`; เวลาแสดงผลให้แปลงตามเขตเวลาตลาด
- ID ใน URL และ JSON ส่งเป็นจำนวนเต็ม
- รายการข้อมูลรองรับ `page` (เริ่มที่ 1), `limit` (ค่าเริ่มต้น 20, สูงสุด 100), `sort` และ `order` เฉพาะที่ endpoint ระบุ
- ค่าค้นหาต้อง trim และจำกัดความยาว; ค่าตัวกรองต้องตรวจสอบกับชุดค่าที่อนุญาต
- ไม่เปิดเผย `password_hash`, credential, stack trace หรือข้อมูลภายในฐานข้อมูล

### รูปแบบ Response มาตรฐาน

สำเร็จรายการเดี่ยว:

```json
{
  "data": {
    "id": 42
  }
}
```

สำเร็จรายการหลายรายการ:

```json
{
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "totalPages": 0
  }
}
```

ข้อผิดพลาด:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "ข้อมูลที่ส่งมาไม่ถูกต้อง",
    "fields": {
      "phone": "รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง"
    }
  }
}
```

### การยืนยันตัวตนและสิทธิ์

- API ของ Shop ที่ต้องล็อกอินใช้ `Authorization: Bearer <access-token>`; token อายุสั้นและควรเก็บใน cookie แบบ `HttpOnly`, `Secure`, `SameSite` เมื่อรูปแบบเว็บรองรับ
- รหัสผ่าน hash ด้วย Argon2id หรือ bcrypt ผ่าน dependency ที่เชื่อถือได้; ห้ามส่งหรือบันทึกรหัสผ่านลง log
- `/auth/register` และ `/auth/login` จำกัดอัตราการเรียก และตอบข้อความทั่วไปเมื่อข้อมูลล็อกอินไม่ถูกต้อง
- ทุก endpoint ที่เป็นข้อมูลส่วนตัวต้องตรวจ token และตรวจความเป็นเจ้าของข้อมูลฝั่งเซิร์ฟเวอร์จาก `user_id`/`shop_id`; ห้ามเชื่อ ID เจ้าของที่ client ส่งมา
- Customer อ่านข้อมูลตลาดและร้านสาธารณะได้โดยไม่ต้องล็อกอิน; endpoint สาธารณะคืน `contact_phone` ของร้าน เพราะตกลงให้เปิดเผยเบอร์ติดต่อ แต่ต้องไม่คืนเบอร์บัญชีผู้ใช้หรือข้อมูลส่วนตัวอื่น
- Admin API อยู่ใต้ `/api/v1/admin/...` ตรวจ token และ `role = 'admin'` ฝั่งเซิร์ฟเวอร์ทุกครั้ง (ไม่ใช่ admin ได้ `403 FORBIDDEN`)
- เว็บเก็บ session เป็น cookie `HttpOnly; SameSite=Strict; Path=/api` (+`Secure` บน HTTPS) และยังรับ `Authorization: Bearer`; คำขอเปลี่ยนข้อมูลที่ใช้ cookie ต้องมี `Origin`/`Referer` เป็นโดเมนเดียวกัน

## รายการ API เวอร์ชันปัจจุบัน

### A. บัญชี Shop

#### `POST /api/v1/auth/register` — สมัครบัญชีและสร้างร้านหลัก

- สิทธิ์: สาธารณะ
- Request:

```json
{
  "email": "shop@example.com",
  "phone": "0812345678",
  "password": "example-password",
  "shopName": "ร้านผักบ้านสวน",
  "category": "ผักและผลไม้",
  "contactPhone": "0812345678"
}
```

- กติกา: `email` หรือ `phone` ต้องมีอย่างน้อยหนึ่งค่า; ตรวจรูปแบบและความซ้ำ; รหัสผ่านต้องผ่านนโยบายความยาวขั้นต่ำที่กำหนด; `shopName` required ไม่เกิน 150 ตัวอักษร; `category` ไม่เกิน 100 ตัวอักษร
- การทำงาน: บันทึก `users` และ `shops` ภายใน transaction เดียว
- Response `201 Created`: `{ "data": { "user": { "id": 7, "email": "shop@example.com", "phone": "0812345678" }, "shop": { "id": 12, "shopName": "ร้านผักบ้านสวน", "category": "ผักและผลไม้" }, "accessToken": "..." } }`
- ข้อผิดพลาด: `400 VALIDATION_ERROR`, `409 ACCOUNT_ALREADY_EXISTS`, `429 RATE_LIMITED`

#### `POST /api/v1/auth/login` — เข้าสู่ระบบ

- สิทธิ์: สาธารณะ
- Request: `{ "login": "shop@example.com", "password": "example-password" }`; `login` ต้องเป็นอีเมล
- Response `200 OK`: `{ "data": { "user": { "id": 7 }, "shop": { "id": 12, "shopName": "ร้านผักบ้านสวน" }, "accessToken": "..." } }`
- ข้อผิดพลาด: `400 VALIDATION_ERROR`, `401 INVALID_CREDENTIALS`, `403 ACCOUNT_DISABLED`, `429 RATE_LIMITED`

#### `POST /api/v1/auth/logout` — ออกจากระบบ

- สิทธิ์: Shop ที่ล็อกอิน
- Request: ไม่ต้องมี body
- Response `204 No Content`; หากใช้ token แบบ stateless ให้เพิกถอน token ด้วยกลไกที่ระบบเลือก หรือใช้ token อายุสั้นและล้าง cookie ฝั่งเว็บ

#### `GET /api/v1/auth/me` — อ่านบัญชีและร้านของฉัน

- สิทธิ์: Shop ที่ล็อกอิน
- Response `200 OK`: `{ "data": { "user": { "id": 7, "email": "shop@example.com", "phone": "0812345678" }, "shop": { "id": 12, "shopName": "ร้านผักบ้านสวน", "category": "ผักและผลไม้", "description": null, "contactPhone": "0812345678" } } }`

### B. ตลาดและแผง

#### `GET /api/v1/markets` — รายชื่อตลาดที่เปิดใช้งาน

- สิทธิ์: สาธารณะ
- Query: `page`, `limit`, `q` (ค้นชื่อหรือที่อยู่)
- Response: รายการ `id`, `marketName`, `address`, `openTime`, `closeTime`, `description`; ไม่ส่งตลาด `is_active = 0`

#### `GET /api/v1/markets/:marketId` — รายละเอียดตลาด

- สิทธิ์: สาธารณะ
- Response: ข้อมูลตลาดที่เปิดใช้งาน พร้อม `events` ที่เกี่ยวข้อง โดยอาจกรองด้วย `fromDate` และ `toDate`
- ข้อผิดพลาด: `400 INVALID_ID`, `404 MARKET_NOT_FOUND`

#### `GET /api/v1/markets/:marketId/events` — รอบตลาด

- สิทธิ์: สาธารณะ
- Query: `fromDate`, `toDate`, `status`, `page`, `limit`; วันที่รูปแบบ `YYYY-MM-DD`
- Response รายการรอบ: `id`, `marketId`, `eventName`, `eventDate`, `openTime`, `closeTime`, `status`
- แสดงเฉพาะรอบที่ไม่ถูกยกเลิกให้ลูกค้าทั่วไป; Shop เลือกรอบที่เปิดรับจองตามนโยบายตลาด

#### `GET /api/v1/markets/:marketId/booths` — แผงและสถานะว่าง

- สิทธิ์: สาธารณะสำหรับผัง/ข้อมูลทั่วไป; หากส่ง `eventId` ให้คำนวณสถานะว่างจากการจองในรอบนั้น
- Query: `eventId` (แนะนำสำหรับสถานะว่าง), `status`, `page`, `limit`
- Response แต่ละรายการ: `id`, `boothCode`, `mapX`, `mapY`, `width`, `depth`, `price`, `availability` โดย `availability` มีค่า `available`, `booked`, `maintenance` หรือ `unavailable`
- ห้ามเปิดเผย `shop_id` หรือข้อมูลผู้จองจาก endpoint นี้
- หมายเหตุ: ค่า `availability` สำหรับ `eventId` คำนวณจาก `bookings` สถานะ `pending`/`confirmed` รวมกับสถานะแผง ไม่ใช้ `booths.status` เพียงอย่างเดียว

#### `GET /api/v1/markets/:marketId/booths/:boothId/events` — สถานะแผงเดียวในทุกรอบที่จะถึง

- สิทธิ์: สาธารณะ; ใช้ในหน้ายืนยันการจองหลายรอบ
- Response: `{ "data": { "booth": { id, boothCode, mapX, mapY, width, depth, price, status }, "events": [ { id, eventName, eventDate, openTime, closeTime, status, bookable, availability } ] } }` — เฉพาะรอบที่ไม่ถูกยกเลิกและวันที่ ≥ วันนี้; ไม่เปิดเผยผู้จอง
- ข้อผิดพลาด: `400 INVALID_ID`, `404 MARKET_NOT_FOUND`, `404 BOOTH_NOT_FOUND`

### C. การจองของ Shop

#### `POST /api/v1/bookings/batch` — จองแผงเดียวหลายรอบ

- สิทธิ์: Shop ที่ล็อกอิน; Request `{ "boothId": 58, "eventIds": [31, 32, 33] }` (1–12 รอบ ไม่ซ้ำ; ไม่รับฟิลด์อื่น)
- การทำงาน: ใช้กติกาเดียวกับ `POST /bookings` ทีละรอบ แต่ละรอบเป็น transaction ของตัวเอง รอบที่ไม่ว่างไม่ทำให้รอบอื่นล้ม
- Response `201`: `{ "data": { "created": [ <booking แบบเดียวกับ POST /bookings> ], "failed": [ { eventId, code, message } ] } }`
- ข้อผิดพลาด: `400 VALIDATION_ERROR`, `409 NO_BOOKING_CREATED` (ไม่มีรอบใดสำเร็จ; `fields` ระบุเหตุผลรายรอบ)

#### `POST /api/v1/bookings` — ส่งคำขอจองแผง

- สิทธิ์: Shop ที่ล็อกอิน
- Request:

```json
{
  "eventId": 31,
  "boothId": 58
}
```

- ไม่รับ `shopId`, `status` หรือ `priceAtBooking` จาก client; เซิร์ฟเวอร์กำหนดจากบัญชี สถานะ และราคาปัจจุบันเอง
- การตรวจสอบ: รอบต้องเปิดรับจอง; แผงและรอบต้องอยู่ตลาดเดียวกัน; แผงต้องใช้งานได้; Shop ต้องไม่จองแผงเดิมในรอบเดียวกันอยู่แล้ว; ต้องไม่มีการจองที่ยัง `pending`/`confirmed` ของผู้ใช้อื่น
- การทำงาน: ใช้ transaction และล็อก/ตรวจซ้ำในฐานข้อมูลก่อน insert; เมื่อผ่านการตรวจสอบให้กำหนด `status` เป็น `confirmed` ทันที ไม่มีขั้นตอนอนุมัติ
- บันทึก `price_at_booking` จากราคาแผง ณ เวลาทำรายการ
- Response `201 Created`: `{ "data": { "id": 91, "event": { "id": 31, "eventDate": "2026-11-07" }, "booth": { "id": 58, "boothCode": "A01" }, "status": "confirmed", "price": 150.00, "bookedAt": "2026-10-31T10:30:00Z" } }`
- ข้อผิดพลาด: `400 VALIDATION_ERROR`, `404 EVENT_OR_BOOTH_NOT_FOUND`, `409 BOOTH_UNAVAILABLE`, `409 DUPLICATE_BOOKING`, `422 EVENT_NOT_BOOKABLE`

#### `GET /api/v1/bookings` — รายการจองของฉัน

- สิทธิ์: Shop ที่ล็อกอิน
- Query: `status`, `fromDate`, `toDate`, `page`, `limit`, `sort` (เช่น `eventDate`), `order` (`asc`/`desc`)
- Response: เฉพาะรายการที่เป็นของ Shop ปัจจุบัน พร้อม `id`, `status`, `price`, `bookedAt`, `cancelledAt`, ข้อมูลตลาด, รอบตลาด และหมายเลขแผง

#### `GET /api/v1/bookings/:bookingId` — รายละเอียดการจอง

- สิทธิ์: Shop ที่ล็อกอินและเป็นเจ้าของรายการ
- Response `200 OK`: รายละเอียดการจอง ตลาด รอบ แผง ราคา ณ วันจอง และสถานะ
- ข้อผิดพลาด: `404 BOOKING_NOT_FOUND` เมื่อไม่มีรายการหรือไม่ใช่เจ้าของ เพื่อไม่เปิดเผยข้อมูลผู้อื่น

#### `POST /api/v1/bookings/:bookingId/cancel` — ยกเลิกการจอง

- สิทธิ์: Shop ที่ล็อกอินและเป็นเจ้าของรายการ
- Request: `{ "reason": "ไม่สะดวกเข้าร่วม" }`; `reason` optional, จำกัดความยาวไม่เกิน 500 ตัวอักษร (หากต้องเก็บเหตุผลถาวรต้องเพิ่มคอลัมน์หรือบันทึกในระบบที่ออกแบบไว้)
- กติกา: ยกเลิกได้เฉพาะสถานะและช่วงเวลาตามนโยบายตลาด เช่น ก่อนวันจัดงาน; รายการที่ยกเลิกแล้วไม่เปลี่ยนซ้ำ
- กติกา: เจ้าของรายการยกเลิกได้ทุกเวลา ไม่จำกัดก่อน/หลังวันจัดงาน; รายการที่ยกเลิกแล้วไม่เปลี่ยนซ้ำ
- การทำงาน: เปลี่ยน `status` เป็น `cancelled` และกำหนด `cancelled_at` ใน transaction โดยไม่ลบประวัติ
- Response `200 OK`: `{ "data": { "id": 91, "status": "cancelled", "cancelledAt": "2026-10-31T11:00:00Z" } }`
- ข้อผิดพลาด: `404 BOOKING_NOT_FOUND`, `409 BOOKING_ALREADY_CANCELLED`, `422 CANCELLATION_NOT_ALLOWED`

### D. ข้อมูลร้านของ Shop

#### `GET /api/v1/shop/profile` — อ่านข้อมูลบัญชีและร้าน

- สิทธิ์: Shop ที่ล็อกอิน
- Response: ข้อมูลร้านและข้อมูลติดต่อของผู้ใช้ปัจจุบัน ไม่รวม `password_hash`

#### `PATCH /api/v1/shop/profile` — แก้ไขข้อมูลร้าน

- สิทธิ์: Shop ที่ล็อกอิน
- Request รับเฉพาะฟิลด์ที่อนุญาต: `shopName`, `category`, `description`, `contactName`, `contactPhone`, `socialUrl` เช่น `{ "shopName": "ร้านผักสด", "category": "ผักและผลไม้", "description": "ผักตามฤดูกาล", "contactName": "สมศรี", "contactPhone": "0812345678", "socialUrl": "https://facebook.com/..." }`
- กติกา: ทุกฟิลด์เป็น optional แต่ต้องมีอย่างน้อยหนึ่งฟิลด์; ตรวจความยาวและรูปแบบ; ห้ามแก้ `userId`, `id`, `createdAt`
- Response `200 OK`: ข้อมูลร้านที่บันทึกแล้ว
- ข้อผิดพลาด: `400 VALIDATION_ERROR`, `401 UNAUTHORIZED`

#### `POST /api/v1/shop/profile/image` และ `DELETE /api/v1/shop/profile/image` — รูปหน้าร้าน

- สิทธิ์: Shop ที่ล็อกอิน; POST รับ `{ "image": "data:image/jpeg;base64,..." }` (body สูงสุด 3 MB เฉพาะ route นี้)
- ตรวจชนิดไฟล์จาก byte จริง (JPEG/PNG/WEBP เท่านั้น ห้าม SVG) ขนาดหลังถอดรหัส ≤ 2 MB; บันทึกเป็น `public/images/shops/shop-<shopId>-<สุ่ม>.<ext>` และตั้ง `image_url`
- DELETE ล้าง `image_url` (ไฟล์เดิมไม่ถูกลบจากดิสก์); ทั้งสองตอบข้อมูลโปรไฟล์ล่าสุด
- ข้อผิดพลาด: `400 VALIDATION_ERROR` (`fields.image`), `401`, `413`

### E. ข้อมูลสาธารณะสำหรับ Customer และ QR Code

> ข้อมูลร้านสาธารณะทุก endpoint มี `imageUrl` และ `socialUrl` เพิ่ม แต่ไม่มี `contactName`

#### `GET /api/v1/public/markets/:marketId/map` — ข้อมูลตลาดและผังสำหรับหน้า QR

- สิทธิ์: สาธารณะ
- Query: `eventId` optional; ถ้ามีให้คืนสถานะการใช้งานร้านในรอบนั้น
- Response `200 OK`:

```json
{
  "data": {
    "market": {
      "id": 3,
      "marketName": "ตลาดนัดสวนกลาง",
      "address": "ถนนตัวอย่าง",
      "openTime": "09:00:00",
      "closeTime": "16:00:00"
    },
    "event": {
      "id": 31,
      "eventName": "ตลาดนัดวันเสาร์",
      "eventDate": "2026-11-07",
      "openTime": "09:00:00",
      "closeTime": "16:00:00"
    },
    "booths": [
      {
        "id": 58,
        "boothCode": "A01",
        "mapX": 12.5,
        "mapY": 30.0,
        "availability": "occupied",
        "shop": {
          "id": 12,
          "shopName": "ร้านผักบ้านสวน",
          "category": "ผักและผลไม้",
          "description": "ผักสดตามฤดูกาล",
          "contactPhone": null
        }
      }
    ]
  }
}
```

- เผยแพร่รายละเอียดร้านเฉพาะร้านที่มีการจอง `confirmed` ในรอบที่เลือก; ถ้าไม่มีรอบ ให้ระบุใน response ว่าแสดงผังทั่วไปหรือร้านปัจจุบันตามนโยบายที่กำหนด
- ไม่ส่งอีเมล เบอร์บัญชีผู้ใช้ หรือข้อมูลการจองส่วนตัว
- กรณีแผงว่าง ส่ง `shop: null`; ตำแหน่งแผงไม่มีร้านให้แสดงหมายเลขแผงและสถานะตามข้อมูลสาธารณะ

#### `GET /api/v1/public/markets/:marketId/shops` — ค้นหาและกรองร้าน

- สิทธิ์: สาธารณะ
- Query: `eventId` optional, `q` (ชื่อ/คำอธิบายร้าน), `category`, `page`, `limit`, `sort` ที่อนุญาต
- Response: ร้านที่ยืนยันเข้าร่วมรอบที่เลือก พร้อมชื่อ ประเภทสินค้า คำอธิบายสาธารณะ หมายเลขแผง และพิกัดผัง; ไม่คืนข้อมูลส่วนตัว
- ข้อผิดพลาด: `400 INVALID_QUERY`, `404 MARKET_NOT_FOUND`

#### `GET /api/v1/public/shops/:shopId` — รายละเอียดร้านสำหรับลูกค้า

- สิทธิ์: สาธารณะ
- Query: `eventId` optional
- Response: ข้อมูลร้านที่เผยแพร่ได้ พร้อมตลาด/รอบ/หมายเลขแผงและพิกัด เมื่อมีการจองยืนยันในรอบนั้น
- ข้อผิดพลาด: `404 SHOP_NOT_FOUND` หากร้านไม่มีข้อมูลสาธารณะหรือไม่เข้าร่วมรอบที่ระบุ

### F. ผู้ดูแลตลาด (Admin) — ต้องล็อกอินและมี `role = 'admin'`

| Method และ Path | การทำงาน |
|---|---|
| `GET /api/v1/admin/overview` | สรุป: ร้านทั้งหมด/ใช้งาน, จำนวนรอบที่จะถึงและวันสุดท้าย, รอบถัดไปพร้อม `bookedCount`, `revenue`, `boothUsable` |
| `GET /api/v1/admin/markets` | ตลาดทั้งหมด รวม `isActive` |
| `PATCH /api/v1/admin/markets/:marketId` | แก้ `marketName`, `address`, `openTime`, `closeTime` (HH:MM), `description`, `isActive` |
| `GET /api/v1/admin/markets/:marketId/events` | รอบทั้งหมดรวมที่งด; query `fromDate`, `toDate`, `status`, `order`, `page`, `limit`; มี `bookedCount`, `revenue`, `ownOpenTime`, `ownCloseTime` |
| `POST /api/v1/admin/markets/:marketId/events` | `{ eventName, eventDate, openTime?, closeTime?, status?, repeatWeeks? (1–26) }` สร้างรอบทุก 7 วัน ข้ามวันที่มีรอบอยู่แล้ว; ตอบ `{ created, skippedDates }` (`201` เมื่อสร้างได้อย่างน้อย 1 รอบ) |
| `PATCH /api/v1/admin/events/:eventId` | แก้ชื่อ/วันที่/เวลา/สถานะ; เปลี่ยนเป็น `cancelled` จะยกเลิกการจองที่ยังใช้งานของรอบนั้นใน transaction เดียว และตอบ `cancelledBookings` |
| `GET /api/v1/admin/markets/:marketId/booths` | แผงทั้งหมดพร้อม `status` จริง |
| `POST /api/v1/admin/markets/:marketId/booths` | `{ boothCode, price, width?, depth?, mapX?, mapY? (0–100), status? }`; รหัสซ้ำ `409 BOOTH_CODE_EXISTS` |
| `PATCH /api/v1/admin/booths/:boothId` | แก้ฟิลด์เดียวกันบางส่วน |
| `GET /api/v1/admin/bookings` | query `eventId`, `status`, `q` (ชื่อร้าน/แผง/อีเมล), `page`, `limit`; มีข้อมูลติดต่อร้าน (`contactName`, `contactPhone`, `email`) |
| `POST /api/v1/admin/bookings/:bookingId/status` | `{ status }`: `pending→confirmed/rejected/cancelled`, `confirmed→rejected/cancelled`; อื่น ๆ `409 INVALID_STATUS_CHANGE` |
| `GET /api/v1/admin/shops` | query `q`, `status` (`active`/`disabled`), `page`, `limit`; มี `upcomingBookings`, `totalBookings` |
| `PATCH /api/v1/admin/shops/:shopId` | `{ isActive }`; ปิดใช้งานแล้ว session ของร้านถูกเพิกถอนทันที; ปิดบัญชีตัวเองไม่ได้ (`422 CANNOT_DISABLE_SELF`) |

ไม่มี endpoint ลบข้อมูล ใช้การเปลี่ยนสถานะแทนตามแนวทางเดิม; การกระทำของ admin บันทึก audit log (มีเฉพาะ ID)

### รหัสสถานะ HTTP และ Error code

- `200 OK`: อ่านหรือแก้ไขข้อมูลสำเร็จ
- `201 Created`: สร้างบัญชีหรือการจองสำเร็จ
- `204 No Content`: ออกจากระบบสำเร็จ ไม่มี response body
- `400 Bad Request`: JSON หรือ query ไม่ถูกต้อง (`VALIDATION_ERROR`, `INVALID_QUERY`)
- `401 Unauthorized`: ไม่มี token หรือ token ไม่ถูกต้อง/หมดอายุ
- `403 Forbidden`: บัญชีปิดใช้งานหรือไม่มีสิทธิ์
- `404 Not Found`: ไม่พบข้อมูลหรือไม่ใช่เจ้าของข้อมูล
- `409 Conflict`: ข้อมูลซ้ำหรือสถานะชนกัน เช่น แผงถูกจองแล้ว
- `422 Unprocessable Entity`: คำขอถูกต้องทางรูปแบบแต่ทำไม่ได้ตามเงื่อนไขธุรกิจ
- `429 Too Many Requests`: เรียกถี่เกินกำหนด
- `500 Internal Server Error`: ข้อผิดพลาดทั่วไป โดยไม่ส่งรายละเอียดภายในกลับ client

### ความปลอดภัยและการตรวจสอบ

- ใช้ parameterized queries ทุกครั้ง ห้ามต่อ SQL จาก input โดยตรง
- ตรวจสอบ body, query, path parameter และชนิดข้อมูลบนเซิร์ฟเวอร์ทุก endpoint
- ป้องกันการเข้าถึงข้อมูลข้ามบัญชีด้วยการตรวจ ownership ใน query/update ไม่ใช่ตรวจจาก client อย่างเดียว
- ใช้ CORS แบบจำกัด origin ตามการใช้งานจริง; หากใช้ cookie ให้ป้องกัน CSRF
- จำกัดขนาด JSON request, จำกัดอัตรา endpoint เข้าสู่ระบบ/สมัครสมาชิก และบันทึก audit log เฉพาะเหตุการณ์จำเป็นโดยไม่เก็บรหัสผ่าน/token
- ส่ง error message ที่ไม่เปิดเผย SQL, schema, path หรือ stack trace
- endpoint สาธารณะควรมี cache ได้เฉพาะข้อมูลตลาด/ผังที่ไม่เป็นส่วนตัว และต้องกำหนดการหมดอายุให้เหมาะสม

### หมายเหตุการแมป API กับหน้าจอ

- เข้าสู่ระบบ/สมัครสมาชิก: `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
- หน้าหลัก Shop: `GET /auth/me`, `GET /bookings`
- เลือกและจองแผง: `GET /markets`, `GET /markets/:marketId/events`, `GET /markets/:marketId/booths`, `POST /bookings`
- รายการ/รายละเอียด/ยกเลิกการจอง: `GET /bookings`, `GET /bookings/:bookingId`, `POST /bookings/:bookingId/cancel`
- โปรไฟล์ Shop: `GET /shop/profile`, `PATCH /shop/profile`
- หน้า QR, ผัง, ค้นหาร้าน และรายละเอียดร้าน: `/public/markets/:marketId/map`, `/public/markets/:marketId/shops`, `/public/shops/:shopId`
- เลือกหลายรอบในหน้ายืนยัน: `GET /markets/:marketId/booths/:boothId/events`, `POST /bookings` (1 รอบ) หรือ `POST /bookings/batch` (หลายรอบ)
- รูปร้าน: `POST`/`DELETE /shop/profile/image`
- ร้านที่อยากแวะ: ไม่ใช้ API เก็บใน `localStorage` ของเบราว์เซอร์ (`tln-plan-<marketId>`)
- Admin: `/admin/...` ตามตาราง F

## เป้าหมายหลัก

- สนับสนุนการจัดสรรและจองแผงร้านค้าอย่างเป็นระบบ
- ทำให้ลูกค้าเข้าถึงแผนผังตลาดได้ง่ายผ่าน QR Code
- ช่วยให้ลูกค้าค้นหาร้านค้าและวางแผนการเดินตลาด
