import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const moduleName = process.argv[2];

if (!moduleName) {
    console.log(
        "❌ Please provide a module name: node scripts/generate-module.js <moduleName>"
    );
    process.exit(1);
}

const capitalizedName =
    moduleName.charAt(0).toUpperCase() + moduleName.slice(1);

const moduleDir = path.join(
    __dirname,
    "../src/app/modules",
    moduleName
);

if (fs.existsSync(moduleDir)) {
    console.log(`❌ Module "${moduleName}" already exists!`);
    process.exit(1);
}

fs.mkdirSync(moduleDir, { recursive: true });



// ─── VALIDATION ──────────────────────────────────────────────────────────────
const validationContent = `import { z } from "zod";

const create${capitalizedName}ValidationSchema = z.object({
  // TODO: add your fields here
  // name: z.string({ required_error: "Name is required." }),
});

const update${capitalizedName}ValidationSchema = z.object({
  // TODO: add your fields here
  // name: z.string().optional(),
});

export const ${capitalizedName}Validation = {
  create${capitalizedName}ValidationSchema,
  update${capitalizedName}ValidationSchema,
};
`;

// ─── SERVICE ─────────────────────────────────────────────────────────────────
const serviceContentV1 = `import httpStatus from "http-status";
import ApiError from "../../errors/ApiError";

export const ${capitalizedName}Service = {
  create: async (payload: any) => {
    const result = await prisma.${moduleName}.create({
      data: payload,
    });
    return result;
  },

  getAll: async (query: Record<string, unknown>) => {
    const ${moduleName}Query = new QueryBuilder(prisma.${moduleName}, query)
      .search([]) // TODO: add searchable fields e.g. ["name", "email"]
      .filter()
      .paginate();

    const [result, meta] = await Promise.all([
      ${moduleName}Query.execute(),
      ${moduleName}Query.countTotal(),
    ]);

    if (!result.length) {
      throw new ApiError(status.NOT_FOUND, "No ${moduleName} found!");
    }

    return { meta, data: result };
  },

  getSingle: async (id: string) => {
    const result = await prisma.${moduleName}.findUnique({
      where: { id },
    });

    if (!result) {
      throw new ApiError(status.NOT_FOUND, "${capitalizedName} not found!");
    }

    return result;
  },

  update: async (id: string, payload: any) => {
    const isExist = await prisma.${moduleName}.findUnique({
      where: { id },
    });

    if (!isExist) {
      throw new ApiError(status.NOT_FOUND, "${capitalizedName} not found!");
    }

    const result = await prisma.${moduleName}.update({
      where: { id },
      data: payload,
    });

    return result;
  },

  delete: async (id: string) => {
    const isExist = await prisma.${moduleName}.findUnique({
      where: { id },
    });

    if (!isExist) {
      throw new ApiError(status.NOT_FOUND, "${capitalizedName} not found!");
    }

    await prisma.${moduleName}.delete({
      where: { id },
    });

    return null;
  },
};
`;

const serviceContent = `import httpStatus from "http-status";
import ApiError from "../../errors/ApiError";
import { query } from "../../utils/db";
import { S3Uploader } from "../../lib/S3Uploader";

const addClient = async (payload: any) => {
    const result = await query("SELECT * FROM users WHERE email = $1", [
      payload.email,
    ]);

    return result;
  };

export const ${capitalizedName}Service = {
  addClient,
};`

// ─── CONTROLLER ──────────────────────────────────────────────────────────────
const controllerContentV1 = `import httpStatus from "http-status";
import { Request, Response } from "express";
import catchAsync from "../../helpers/catchAsync";
import { ${capitalizedName}Service } from "./${moduleName}.service";
import sendResponse from "../../helpers/sendResponse";

const create = catchAsync(async (req: Request, res: Response) => {
  const result = await ${capitalizedName}Service.create(req.body);
  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,
    message: "${capitalizedName} created successfully!",
    data: result,
  });
});

const getAll = catchAsync(async (req: Request, res: Response) => {
  const result = await ${capitalizedName}Service.getAll(req.query);
  sendResponse(res, {
    statusCode: status.OK,
    message: "${capitalizedName}s retrieved successfully!",
    meta: result.meta,
    data: result.data,
  });
});

const getSingle = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await ${capitalizedName}Service.getSingle(id);
  sendResponse(res, {
    statusCode: status.OK,
    message: "${capitalizedName} retrieved successfully!",
    data: result,
  });
});

const update = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await ${capitalizedName}Service.update(id, req.body);
  sendResponse(res, {
    statusCode: status.OK,
    message: "${capitalizedName} updated successfully!",
    data: result,
  });
});

const remove = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  await ${capitalizedName}Service.delete(id);
  sendResponse(res, {
    statusCode: status.OK,
    message: "${capitalizedName} deleted successfully!",
  });
});

export const ${capitalizedName}Controller = {
  create,
  getAll,
  getSingle,
  update,
  remove,
};
`;

const controllerContent = `import httpStatus from "http-status";
import { Request, Response } from "express";
import catchAsync from "../../helpers/catchAsync";
import { ${capitalizedName}Service } from "./${moduleName}.service";
import sendResponse from "../../helpers/sendResponse";

const addClient = catchAsync(async (req: Request, res: Response) => {
  const result = await ${capitalizedName}Service.addClient(req.body);
  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Client added successfully!",
    data: result,
  });
});

export const ${capitalizedName}Controller = {
  addClient,
};`

// ─── ROUTE ───────────────────────────────────────────────────────────────────
const routeContentV1 = `import { Router } from "express";
import { ${capitalizedName}Controller } from "./${moduleName}.controller";
import { ${capitalizedName}Validation } from "./${moduleName}.validation";
import validateRequest from "../../middlewares/validateRequest";
import auth from "../../middlewares/auth";
import { UserRole } from "@prisma/client";

const router = Router();

router.post(
  "/create",
  auth(UserRole.ADMIN),
  validateRequest(${capitalizedName}Validation.create${capitalizedName}ValidationSchema),
  ${capitalizedName}Controller.create
);

router.get(
  "/get-all",
  auth(UserRole.ADMIN),
  ${capitalizedName}Controller.getAll
);

router.get(
  "/get/:id",
  auth(),
  ${capitalizedName}Controller.getSingle
);

router.patch(
  "/update/:id",
  auth(),
  validateRequest(${capitalizedName}Validation.update${capitalizedName}ValidationSchema),
  ${capitalizedName}Controller.update
);

router.delete(
  "/delete/:id",
  auth(UserRole.ADMIN),
  ${capitalizedName}Controller.remove
);

export const ${capitalizedName}Routes = router;
`;

const routeContent = `import { Router } from "express";
import { ${capitalizedName}Controller } from "./${moduleName}.controller";
import { ${capitalizedName}Validation } from "./${moduleName}.validation";
import validateRequest from "../../middlewares/validateRequest";
import auth from "../../middlewares/auth";

const router = Router();

router.post(
  "/add-client",
  auth("ADMIN"),
  validateRequest(${capitalizedName}Validation.addClientValidationSchema),
  ${capitalizedName}Controller.addClient
);

export const ${capitalizedName}Routes = router;
`;

// ─── WRITE FILES ─────────────────────────────────────────────────────────────
const files = {
    [`${moduleName}.validation.ts`]: validationContent,
    [`${moduleName}.service.ts`]: serviceContent,
    [`${moduleName}.controller.ts`]: controllerContent,
    [`${moduleName}.route.ts`]: routeContent,
};

Object.entries(files).forEach(([fileName, content]) => {
    fs.writeFileSync(path.join(moduleDir, fileName), content);
    console.log(`✅ Created: ${fileName}`);
});

console.log(`\n🎉 Module "${moduleName}" generated successfully!`);
console.log(`📁 Location: src/app/modules/${moduleName}/`);
console.log(`\n⚠️  Don't forget to:`);
console.log(`   1. Add your fields in ${moduleName}.validation.ts`);
console.log(`   2. Register the route in your main routes file:`);
console.log(`      { path: "/${moduleName}", route: ${capitalizedName}Routes }`);