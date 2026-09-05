import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, MoreVertical, Search, Film, Wallet, Zap, Dumbbell, GraduationCap, Settings as SettingsIcon, Utensils, Plane, Newspaper, Plus, X, Pencil, Trash2 } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { api, CategorySummaryItem } from '../lib/api';

interface CategoryViewProps {
  onBack: () => void;
}

const PRESET_CATEGORY_COLORS = ['#0054cd', '#4c4aca', '#894d00', '#2e7d32', '#ec4899', '#0ea5e9', '#6366f1', '#16a34a'];

const getIconByCategoryName = (name: string) => {
  const normalized = name.toLowerCase();
  if (normalized.includes('movie') || normalized.includes('entertainment')) return Film;
  if (normalized.includes('finance') || normalized.includes('wallet')) return Wallet;
  if (normalized.includes('fitness') || normalized.includes('health')) return Dumbbell;
  if (normalized.includes('education')) return GraduationCap;
  if (normalized.includes('food') || normalized.includes('drink')) return Utensils;
  if (normalized.includes('travel')) return Plane;
  if (normalized.includes('news')) return Newspaper;
  if (normalized.includes('utility') || normalized.includes('setting')) return SettingsIcon;
  return Zap;
};

export default function CategoryView({ onBack }: CategoryViewProps) {
  const [categories, setCategories] = useState<CategorySummaryItem[]>([]);
  const [uncategorizedCount, setUncategorizedCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [categoryModalMode, setCategoryModalMode] = useState<'create' | 'edit'>('create');
  const [editingCustomCategoryId, setEditingCustomCategoryId] = useState<number | null>(null);
  const [customCategoryName, setCustomCategoryName] = useState('');
  const [customCategoryColor, setCustomCategoryColor] = useState('#16a34a');
  const [submittingCustom, setSubmittingCustom] = useState(false);
  const [deletingCategoryId, setDeletingCategoryId] = useState<number | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [categoryData, subscriptions] = await Promise.all([
        api.getCategorySummary(),
        api.getSubscriptions(),
      ]);
      setCategories(categoryData);
      setUncategorizedCount(
        subscriptions.filter((sub) => !sub.category || !sub.category.trim()).length
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load categories');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const filteredCategories = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return categories;
    return categories.filter((cat) => cat.name.toLowerCase().includes(query));
  }, [categories, searchQuery]);

  const categorizeNow = async () => {
    try {
      const subscriptions = await api.getSubscriptions();
      const uncategorized = subscriptions.filter((sub) => !sub.category || !sub.category.trim());
      if (uncategorized.length === 0) return;

      await Promise.all(
        uncategorized.map((sub) => api.updateSubscriptionCategory(sub.id, 'Unassigned'))
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to categorize subscriptions');
    }
  };

  const closeCategoryModal = () => {
    setShowCreateModal(false);
    setCategoryModalMode('create');
    setEditingCustomCategoryId(null);
    setCustomCategoryName('');
    setCustomCategoryColor('#16a34a');
  };

  const openCreateCustomCategory = () => {
    setError(null);
    setCategoryModalMode('create');
    setEditingCustomCategoryId(null);
    setCustomCategoryName('');
    setCustomCategoryColor('#16a34a');
    setShowCreateModal(true);
  };

  const openEditCustomCategory = (category: CategorySummaryItem) => {
    const customId = Number(category.customCategoryId || 0);
    if (!customId) return;
    setError(null);
    setCategoryModalMode('edit');
    setEditingCustomCategoryId(customId);
    setCustomCategoryName(category.name);
    setCustomCategoryColor(category.color || '#16a34a');
    setShowCreateModal(true);
  };

  const handleSubmitCustomCategory = async () => {
    const name = customCategoryName.trim();
    if (!name) {
      setError('Category name is required');
      return;
    }

    try {
      setSubmittingCustom(true);
      setError(null);

      if (categoryModalMode === 'edit' && editingCustomCategoryId) {
        await api.updateCustomCategory(editingCustomCategoryId, {
          name,
          color: customCategoryColor,
        });
      } else {
        await api.createCustomCategory({
          name,
          color: customCategoryColor,
        });
      }

      closeCategoryModal();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save custom category');
    } finally {
      setSubmittingCustom(false);
    }
  };

  const handleDeleteCustomCategory = async (category: CategorySummaryItem) => {
    const customId = Number(category.customCategoryId || 0);
    if (!customId) return;

    const confirmed = window.confirm(
      `Delete category "${category.name}"? Subscriptions under this category will be moved to uncategorized.`
    );
    if (!confirmed) return;

    try {
      setDeletingCategoryId(customId);
      setError(null);
      await api.deleteCustomCategory(customId);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete custom category');
    } finally {
      setDeletingCategoryId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-surface flex flex-col">
      <header className="safe-area-header sticky top-0 z-40 glass-effect flex items-center justify-between px-6 py-4 w-full">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="hover:opacity-80 transition-opacity scale-95 active:duration-100 text-primary">
            <ArrowLeft size={24} />
          </button>
          <h1 className="font-manrope font-bold text-lg text-primary">All Categories</h1>
        </div>
        <button className="text-on-surface-variant hover:opacity-80 transition-opacity">
          <MoreVertical size={24} />
        </button>
      </header>

      <main className="px-6 pt-2 overflow-y-auto no-scrollbar pb-32">
        {loading ? (
          <div className="h-60 flex items-center justify-center text-on-surface-variant">
            <Loader2 className="animate-spin" size={30} />
          </div>
        ) : (
          <>
        {error && (
          <div className="mb-4 bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-600">{error}</div>
        )}

        <section className="mb-8">
          <div className="relative group">
            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
              <Search className="text-on-surface-variant/60" size={20} />
            </div>
            <input 
              className="w-full h-14 pl-12 pr-4 bg-surface-container-low border-none rounded-xl focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-lowest transition-all duration-300 placeholder:text-on-surface-variant/60 text-on-surface" 
              placeholder="Search categories..." 
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </section>

        <section className="grid grid-cols-2 gap-4">
          {filteredCategories.map((cat) => {
            const Icon = getIconByCategoryName(cat.name);
            return (
              <div 
                key={cat.name}
                className="relative bg-surface-container-lowest p-6 rounded-xl shadow-sm flex flex-col items-start gap-4 hover:scale-[0.98] transition-transform duration-200 cursor-pointer border border-outline-variant/10"
              >
                {cat.isCustom && cat.customCategoryId ? (
                  <div className="absolute top-3 right-3 flex items-center gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditCustomCategory(cat);
                      }}
                      className="w-7 h-7 rounded-lg bg-surface-container-low text-on-surface-variant hover:text-primary flex items-center justify-center"
                      aria-label={`Edit ${cat.name}`}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteCustomCategory(cat);
                      }}
                      disabled={deletingCategoryId === Number(cat.customCategoryId)}
                      className="w-7 h-7 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-60 flex items-center justify-center"
                      aria-label={`Delete ${cat.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ) : null}

                <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${cat.color}15` }}>
                  <Icon size={24} style={{ color: cat.color }} />
                </div>
                <div>
                  <h3 className="font-manrope font-bold text-on-surface">{cat.name}</h3>
                  <p className="text-xs font-medium text-on-surface-variant/60">{cat.count} Subscriptions • ${cat.monthlyTotal.toFixed(2)}/mo</p>
                </div>
              </div>
            );
          })}

          <button
            onClick={openCreateCustomCategory}
            className="bg-white border-2 border-dashed border-outline-variant/30 p-6 rounded-xl flex flex-col items-start gap-4 hover:bg-surface-container-low transition-colors duration-200 cursor-pointer text-left"
          >
            <div className="w-12 h-12 rounded-xl bg-surface-container-low flex items-center justify-center text-on-surface-variant/40">
              <Plus size={24} />
            </div>
            <div>
              <h3 className="font-manrope font-bold text-on-surface-variant/60">Add Custom</h3>
              <p className="text-xs font-medium text-on-surface-variant/40">Create new</p>
            </div>
          </button>
        </section>

        <section className="mt-8 mb-4">
          <div className="relative w-full h-40 rounded-xl overflow-hidden group">
            <img 
              alt="Financial visualization" 
              className="w-full h-full object-cover" 
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuBn3E1js782fA0i9zXLq-Rh5-st8tw8I45HaWpxr7btuw_tTcdyZ6n7mFKTtXVVPFw0uie61ectDnY6BXF6pZZk32eLX_QuKj_2h61E18LEXD0G6V5xYsPEFLAVw164nWX0qmhabC3zYXsUBHaqlYcDZueManOYhs4q2ZQ9M9CiEaY5XKT5BA5oX5-dmznB57Xdm2pJaAeK_Aib2c2dtCt6_J0_lhZyI74ufVGuEDwUMXO52qnJa4cCVAUEUh53smdh_Uw0pZQU2P1G"
              referrerPolicy="no-referrer"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-primary/90 to-primary-container/40 p-6 flex flex-col justify-center">
              <h4 className="font-manrope font-extrabold text-white text-xl mb-1">Smart Insights</h4>
              <p className="text-white/80 text-sm max-w-[200px]">
                We've detected {uncategorizedCount} subscriptions without a category.
              </p>
              <button
                onClick={categorizeNow}
                className="mt-3 bg-white text-primary text-xs font-bold py-2 px-4 rounded-full w-fit hover:bg-surface-bright transition-colors"
              >
                Categorize Now
              </button>
            </div>
          </div>
        </section>

        {showCreateModal && (
          <div className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
            <div className="bg-surface w-full max-w-md rounded-3xl p-6 space-y-4 border border-outline-variant/10">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-on-surface">
                  {categoryModalMode === 'edit' ? 'Edit Custom Category' : 'Create Custom Category'}
                </h3>
                <button
                  onClick={closeCategoryModal}
                  className="p-2 hover:bg-surface-container-low rounded-full"
                >
                  <X size={18} className="text-on-surface-variant" />
                </button>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-on-surface-variant">Category Name</label>
                <input
                  type="text"
                  value={customCategoryName}
                  onChange={(e) => setCustomCategoryName(e.target.value)}
                  placeholder="e.g. Learning"
                  maxLength={50}
                  className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-on-surface-variant">Category Color</label>
                <div className="flex items-center gap-2 flex-wrap">
                  {PRESET_CATEGORY_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setCustomCategoryColor(color)}
                      className="w-8 h-8 rounded-full border-2"
                      style={{
                        backgroundColor: color,
                        borderColor: customCategoryColor === color ? '#111827' : 'transparent',
                      }}
                      aria-label={`Select color ${color}`}
                    />
                  ))}
                  <input
                    type="color"
                    value={customCategoryColor}
                    onChange={(e) => setCustomCategoryColor(e.target.value)}
                    className="w-10 h-8 rounded border border-outline-variant/20 bg-transparent"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={closeCategoryModal}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleSubmitCustomCategory()}
                  disabled={submittingCustom}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-primary hover:opacity-90 disabled:opacity-70"
                >
                  {submittingCustom
                    ? (categoryModalMode === 'edit' ? 'Saving...' : 'Creating...')
                    : (categoryModalMode === 'edit' ? 'Save' : 'Create')}
                </button>
              </div>
            </div>
          </div>
        )}
          </>
        )}
      </main>
    </div>
  );
}
