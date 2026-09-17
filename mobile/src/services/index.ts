import {
  adminRepository,
  authRepository,
  categoryRepository,
  commentRepository,
  observabilityRepository,
  pickRepository,
  productRepository,
  profileRepository,
  photoRepository,
  readRepository,
  safetyRepository,
} from '@/repositories/supabase';

import { DevicePhotoRepository } from '@/repositories/device/devicePhotoRepository';
import { AdminService } from './adminService';
import { AuthService } from './authService';
import { CommentService } from './commentService';
import { ExploreService } from './exploreService';
import { HomeService } from './homeService';
import { ObservabilityService } from './observabilityService';
import { PickService } from './pickService';
import { ProductService } from './productService';
import { ProfileService } from './profileService';
import { RegistrationService } from './registrationService';
import { SafetyService } from './safetyService';

export const adminService = new AdminService(adminRepository, profileRepository);
export const registrationService = new RegistrationService(categoryRepository, pickRepository, productRepository, photoRepository, new DevicePhotoRepository());

export const authService = new AuthService(authRepository);
export const observabilityService = new ObservabilityService(observabilityRepository);
export const safetyService = new SafetyService(safetyRepository);
export const commentService = new CommentService(
  commentRepository,
  pickRepository,
  profileRepository,
  readRepository,
);
export const exploreService = new ExploreService(
  categoryRepository,
  readRepository,
);
export const homeService = new HomeService(
  categoryRepository,
  productRepository,
  readRepository,
);
export const pickService = new PickService(
  pickRepository,
  categoryRepository,
  productRepository,
  readRepository,
);
export const productService = new ProductService(
  productRepository,
  pickRepository,
  categoryRepository,
  readRepository,
);
export const profileService = new ProfileService(
  profileRepository,
  readRepository,
);

export {
  AdminService,
  AuthService,
  CommentService,
  ExploreService,
  HomeService,
  ObservabilityService,
  PickService,
  ProductService,
  ProfileService,
  SafetyService,
};
