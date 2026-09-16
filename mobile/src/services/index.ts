import {
  categoryRepository,
  pickRepository,
  productRepository,
  profileRepository,
} from '@/repositories/supabase';

import { HomeService } from './homeService';
import { PickService } from './pickService';
import { ProductService } from './productService';
import { ProfileService } from './profileService';

export const homeService = new HomeService(categoryRepository, pickRepository);
export const pickService = new PickService(
  pickRepository,
  categoryRepository,
  productRepository,
);
export const productService = new ProductService(productRepository, pickRepository);
export const profileService = new ProfileService(profileRepository, pickRepository);

export { HomeService, PickService, ProductService, ProfileService };
