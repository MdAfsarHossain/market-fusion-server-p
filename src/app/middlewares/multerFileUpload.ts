import multer from "multer";
import path from "path";
// Multer storage configuration
const storage1 = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(process.cwd(), "public", "uploads"));
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  },
});

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(process.cwd(), "public", "uploads"));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = `${Date.now()}`;
    const ext = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, ext);
    cb(null, `${baseName}-${uniqueSuffix}${ext}`);
  },
});

// ✅ Use memory storage (no disk writes!)
const uploadTest = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

const testFiles = uploadTest.array("files", 5);
const testFile = uploadTest.single("file");

const upload = multer({ storage });

const uploadVehicleDoc = uploadTest.fields([
  { name: "insuranceCard", maxCount: 1 },
  { name: "vehicleImage", maxCount: 1 },
]);

const sendMsg = uploadTest.single("fileImage");
const profileImage = uploadTest.single("profileImage");
const uploadCategoryIcon = uploadTest.single("categoryIcon");
const uploadProductImage = uploadTest.array("productImage", 5);
const image = uploadTest.single("image");
const files = uploadTest.array("files", 5);
const avatar = uploadTest.single("avatar");
const logo = uploadTest.single("logo");
const cover_images = uploadTest.array("cover_images", 10);

const inventoryImage = uploadTest.array("images", 10);

// Marketplace uploaders
const storeAssets = uploadTest.fields([
  { name: "logo", maxCount: 1 },
  { name: "banner", maxCount: 1 },
]);

const productAssets = uploadTest.fields([
  { name: "thumbnail", maxCount: 1 },
  { name: "images", maxCount: 10 },
  { name: "digital_file", maxCount: 1 },
]);

const categoryAssets = uploadTest.fields([
  { name: "icon", maxCount: 1 },
  { name: "image", maxCount: 1 },
]);

const digitalAsset = uploadTest.single("digital_file");

// Export file uploader methods
export const fileUploader = {
  upload,
  storeAssets,
  productAssets,
  categoryAssets,
  digitalAsset,
  businessDocUpload: uploadTest.fields([
    { name: "kvk_or_eu_vat", maxCount: 1 },
    { name: "license_or_utility_bill", maxCount: 1 },
    { name: "id_legal_representative", maxCount: 1 },
  ]),
  kycDocUpload: uploadTest.fields([
    { name: "government_id_front_part", maxCount: 1 },
    { name: "government_id_back_part", maxCount: 1 },
    { name: "government_id_verification_video", maxCount: 1 },
  ]),
  profileImage,
  uploadVehicleDoc,
  uploadCategoryIcon,
  uploadProductImage,
  sendMsg,
  image,
  files,
  avatar,
  inventoryImage,
  logo,
  branchLogoAndCover: uploadTest.fields([
    { name: "logo", maxCount: 1 },
    { name: "cover_images", maxCount: 10 },
  ]),
  branchCoverImages: uploadTest.fields([
    { name: "cover_images", maxCount: 10 },
  ]),
  testFile,
  testFiles,
};
