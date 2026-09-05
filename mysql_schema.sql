CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    google_id VARCHAR(255),
    name VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create the subscriptions table for MySQL
CREATE TABLE IF NOT EXISTS subscriptions (
  id VARCHAR(36) PRIMARY KEY,
  user_id INT,
  name VARCHAR(255) NOT NULL,
  icon VARCHAR(255),
  price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  billing_cycle ENUM('monthly', 'annually') NOT NULL DEFAULT 'monthly',
  next_billing_date DATE,
  category VARCHAR(50),
  account VARCHAR(50),
  region VARCHAR(50),
  status ENUM('normal', 'urgent', 'trial', 'expired') NOT NULL DEFAULT 'normal',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_subscriptions_user_id (user_id),
  CONSTRAINT fk_subscriptions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create memberships table
CREATE TABLE IF NOT EXISTS memberships (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  plan ENUM('trial', 'monthly', 'annual', 'lifetime') NOT NULL,
  status ENUM('trial', 'active', 'expired', 'canceled') NOT NULL DEFAULT 'active',
  amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  currency VARCHAR(10) NOT NULL DEFAULT 'CNY',
  payment_method VARCHAR(50) NOT NULL,
  payer_email VARCHAR(255) NOT NULL,
  auto_renew BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at DATETIME NOT NULL,
  expires_at DATETIME,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_memberships_user_id (user_id),
  CONSTRAINT fk_memberships_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create payment methods table
CREATE TABLE IF NOT EXISTS payment_methods (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  label VARCHAR(120) NOT NULL,
  method_type ENUM('apple_pay', 'credit_card', 'paypal', 'bank_transfer', 'other') NOT NULL,
  account_ref VARCHAR(120),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_payment_methods_user_id (user_id),
  CONSTRAINT fk_payment_methods_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  notification_key VARCHAR(191) NOT NULL,
  type ENUM('billing_due', 'trial_ending', 'membership', 'system') NOT NULL DEFAULT 'system',
  title VARCHAR(255) NOT NULL,
  message VARCHAR(500) NOT NULL,
  severity ENUM('info', 'warning', 'critical') NOT NULL DEFAULT 'info',
  related_subscription_id VARCHAR(36),
  action_text VARCHAR(80),
  action_target VARCHAR(255),
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  read_at DATETIME,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_notification_key (user_id, notification_key),
  INDEX idx_notifications_user_id (user_id),
  INDEX idx_notifications_read (user_id, is_read),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create user settings table
CREATE TABLE IF NOT EXISTS user_settings (
  user_id INT PRIMARY KEY,
  theme ENUM('Light', 'Dark') NOT NULL DEFAULT 'Light',
  language ENUM('English', '简体中文', '繁體中文', 'Latin', '한국어') NOT NULL DEFAULT 'English',
  app_lock_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  cloud_sync_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_synced_at DATETIME,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create custom categories table
CREATE TABLE IF NOT EXISTS custom_categories (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(80) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#0054cd',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_custom_categories_user_name (user_id, name),
  INDEX idx_custom_categories_user_id (user_id),
  CONSTRAINT fk_custom_categories_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);