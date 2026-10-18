import httpStatus from "http-status";
import { Request, Response } from "express";
import catchAsync from "../../helpers/catchAsync";
import sendResponse from "../../helpers/sendResponse";
import { CategoryService } from "./category.service";

// Create category
const createCategory = catchAsync(async (req: Request, res: Response) => {
  const files = req.files;
  const result = await CategoryService.createCategory(req.body, files as any);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Category created successfully",
    data: result,
  });
});

// All categories - flat
const allCategories = catchAsync(async (req: Request, res: Response) => {
  const result = await CategoryService.allCategories(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Categories fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

// Category tree - nested
const categoryTree = catchAsync(async (req: Request, res: Response) => {
  const result = await CategoryService.categoryTree(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Category tree fetched successfully",
    data: result,
  });
});

// Single category by slug
const categoryBySlug = catchAsync(async (req: Request, res: Response) => {
  const { slug } = req.params;
  const result = await CategoryService.categoryBySlug(slug);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Category fetched successfully",
    data: result,
  });
});

// Update category
const updateCategory = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const files = req.files;
  const result = await CategoryService.updateCategory(
    id,
    req.body,
    files as any,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Category updated successfully",
    data: result,
  });
});

// Delete category
const deleteCategory = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await CategoryService.deleteCategory(id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Category deleted successfully",
    data: result,
  });
});

export const CategoryController = {
  createCategory,
  allCategories,
  categoryTree,
  categoryBySlug,
  updateCategory,
  deleteCategory,
};
