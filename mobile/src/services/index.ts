import {
  adminRepository,
  authRepository,
  categoryRepository,
  commentRepository,
  pickRepository,
  productRepository,
  profileRepository,
  photoRepository,
} from '@/repositories/supabase';

import { DevicePhotoRepository } from '@/repositories/device/devicePhotoRepository';
import { AdminService } from './adminService';
import { AuthService } from './authService';
import { CommentService } from './commentService';
import { ExploreService } from './exploreService';
import { HomeService } from './homeService';
import { PickService } from './pickService';
import { ProductService } from './productService';
import { ProfileService } from './profileService';
import { RegistrationService } from './registrationService';

export const adminService = new AdminService(adminRepository, profileRepository);
export const registrationService = new RegistrationService(categoryRepository, pickRepository, productRepository, photoRepository, new DevicePhotoRepository());

export const authService = new AuthService(authRepository);
export const commentService = new CommentService(
  commentRepository,
  pickRepository,
  profileRepository,
);
export const exploreService = new ExploreService(
  categoryRepository,
  pickRepository,
  productRepository,
  profileRepository,
);
export const homeService = new HomeService(
  categoryRepository,
  pickRepository,
  productRepository,
  profileRepository,
);
export const pickService = new PickService(
  pickRepository,
  categoryRepository,
  productRepository,
  profileRepository,
);
export const productService = new ProductService(
  productRepository,
  pickRepository,
  profileRepository,
  categoryRepository,
);
export const profileService = new ProfileService(
  profileRepository,
  pickRepository,
  categoryRepository,
  productRepository,
);

export {
  AdminService,
  AuthService,
  CommentService,
  ExploreService,
  HomeService,
  PickService,
  ProductService,
  ProfileService,
};
