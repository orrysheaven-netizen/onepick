import {
  adminRepository,
  authRepository,
  categoryRepository,
  commentRepository,
  followRepository,
  observabilityRepository,
  pickRepository,
  itemRepository,
  movieCatalogRepository,
  musicCatalogRepository,
  gameCatalogRepository,
  bookCatalogRepository,
  youtubeCatalogRepository,
  pokemonCatalogRepository,
  placeCatalogRepository,
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
import { FollowService } from './followService';
import { HomeService } from './homeService';
import { ObservabilityService } from './observabilityService';
import { PickService } from './pickService';
import { ItemService } from './itemService';
import { MovieCatalogService } from './movieCatalogService';
import { MusicCatalogService } from './musicCatalogService';
import { GameCatalogService } from './gameCatalogService';
import { BookCatalogService } from './bookCatalogService';
import { YouTubeCatalogService } from './youtubeCatalogService';
import { PokemonCatalogService } from './pokemonCatalogService';
import { PlaceCatalogService } from './placeCatalogService';
import { ProfileService } from './profileService';
import { RegistrationService } from './registrationService';
import { SafetyService } from './safetyService';

export const adminService = new AdminService(adminRepository, profileRepository);
export const registrationService = new RegistrationService(categoryRepository, pickRepository, itemRepository, photoRepository, new DevicePhotoRepository());

export const authService = new AuthService(authRepository);
export const observabilityService = new ObservabilityService(observabilityRepository);
export const safetyService = new SafetyService(safetyRepository);
export const commentService = new CommentService(
  commentRepository,
  pickRepository,
  profileRepository,
  readRepository,
);
export const followService = new FollowService(followRepository, readRepository);
export const exploreService = new ExploreService(
  categoryRepository,
  readRepository,
);
export const homeService = new HomeService(readRepository);
export const pickService = new PickService(
  pickRepository,
  categoryRepository,
  itemRepository,
  readRepository,
);
export const itemService = new ItemService(
  itemRepository,
  pickRepository,
  categoryRepository,
  readRepository,
);
export const movieCatalogService = new MovieCatalogService(movieCatalogRepository);
export const musicCatalogService = new MusicCatalogService(musicCatalogRepository);
export const gameCatalogService = new GameCatalogService(gameCatalogRepository);
export const bookCatalogService = new BookCatalogService(bookCatalogRepository);
export const youtubeCatalogService = new YouTubeCatalogService(youtubeCatalogRepository);
export const pokemonCatalogService = new PokemonCatalogService(pokemonCatalogRepository);
export const placeCatalogService = new PlaceCatalogService(placeCatalogRepository);
export const profileService = new ProfileService(
  profileRepository,
  readRepository,
  itemRepository,
);

export {
  AdminService,
  AuthService,
  CommentService,
  ExploreService,
  FollowService,
  HomeService,
  ObservabilityService,
  PickService,
  ItemService,
  MovieCatalogService,
  MusicCatalogService,
  GameCatalogService,
  BookCatalogService,
  YouTubeCatalogService,
  PokemonCatalogService,
  PlaceCatalogService,
  ProfileService,
  SafetyService,
};
