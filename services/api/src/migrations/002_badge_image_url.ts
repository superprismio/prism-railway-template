export const badgeImageUrlMigration = {
  name: '002_badge_image_url',
  sql: `
    ALTER TABLE badges
    ADD COLUMN image_url TEXT;
  `,
};