import {
  authRepository,
  categoryRepository,
  pickRepository,
  productRepository,
  profileRepository,
} from '@/repositories/supabase';

import { AuthService } from './authService';
import { HomeService } from './homeService';
import { PickService } from './pickService';
import { ProductService } from './productService';
import { ProfileService } from './profileService';

export const authService = new AuthService(authRepository);
export const homeService = new HomeService(
  categoryRepository,
  pickRepository,
  productRepository,
);
export const pickService = new PickService(
  pickRepository,
  categoryRepository,
  productRepository,
  profileRepository,
);
export const productService = new ProductService(productRepository, pickRepository);
export const profileService = new ProfileService(
  profileRepository,
  pickRepository,
  categoryRepository,
  productRepository,
);

export { AuthService, HomeService, PickService, ProductService, ProfileService };
