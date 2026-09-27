import React, { useEffect, useRef, useState } from 'react';
import { Search, ChevronRight, ImagePlus, FolderOpen, Loader2, Globe } from 'lucide-react';
import { api, resolveAssetUrl } from '../lib/api';

interface IconSelectionProps {
  onSelect: (icon: string) => void;
  onBack: () => void;
}

// 热门图标本地自托管（public/icons/，iTunes 拉取的真实应用图标）：
// 不再引用 googleusercontent 等大陆不可达的外链，本地列表即点即显。
const SERVICES = [
  { name: 'Netflix', icon: '/icons/netflix.png' },
  { name: 'Spotify', icon: '/icons/spotify.png' },
  { name: 'YouTube', icon: '/icons/youtube.png' },
  { name: 'ChatGPT', icon: '/icons/chatgpt.png' },
  { name: 'Notion', icon: '/icons/notion.png' },
  { name: 'Apple Music', icon: '/icons/apple-music.png' },
  { name: 'Steam', icon: '/icons/steam.png' },
  { name: 'Disney+', icon: '/icons/disney-plus.png' },
  { name: 'Prime Video', icon: '/icons/prime-video.png' },
  { name: 'HBO Max', icon: '/icons/hbo-max.png' },
  { name: 'Slack', icon: '/icons/slack.png' },
  { name: 'Discord', icon: '/icons/discord.png' },
  { name: 'Canva', icon: '/icons/canva.png' },
  { name: 'Dropbox', icon: '/icons/dropbox.png' },
  { name: '爱奇艺', icon: '/icons/iqiyi.png' },
  { name: '腾讯视频', icon: '/icons/tencent-video.png' },
  { name: '优酷', icon: '/icons/youku.png' },
  { name: '芒果TV', icon: '/icons/mango-tv.png' },
  { name: '哔哩哔哩', icon: '/icons/bilibili.png' },
  { name: '网易云音乐', icon: '/icons/netease-music.png' },
  { name: 'QQ音乐', icon: '/icons/qq-music.png' },
  { name: '喜马拉雅', icon: '/icons/ximalaya.png' },
  { name: '百度网盘', icon: '/icons/baidu-netdisk.png' },
  { name: 'WPS Office', icon: '/icons/wps.png' },
  { name: '知乎', icon: '/icons/zhihu.png' },
  { name: '微博', icon: '/icons/weibo.png' },
  { name: '京东', icon: '/icons/jd.png' },
  { name: '淘宝', icon: '/icons/taobao.png' },
  { name: '支付宝', icon: '/icons/alipay.png' },
  { name: '夸克', icon: '/icons/quark.png' },
];

interface OnlineIcon {
  name: string;
  url: string;
}

export default function IconSelection({ onSelect, onBack }: IconSelectionProps) {
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [folderFiles, setFolderFiles] = useState<Array<{ file: File; name: string; preview: string }>>([]);
  const [onlineIcons, setOnlineIcons] = useState<OnlineIcon[] | null>(null);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const keyword = search.trim();
  const filtered = SERVICES.filter(s => s.name.toLowerCase().includes(keyword.toLowerCase()));

  // 在线搜索（iTunes Search API，中大陆常用应用覆盖好，含 CN/US 两个区）：
  // 400ms 防抖；请求失败静默降级为纯本地列表，不影响选择和上传
  useEffect(() => {
    if (!keyword) {
      setOnlineIcons(null);
      setOnlineLoading(false);
      return;
    }
    let active = true;
    setOnlineLoading(true);
    const timer = setTimeout(async () => {
      try {
        const query = 'https://itunes.apple.com/search?entity=software&limit=12&term=' + encodeURIComponent(keyword);
        const [cn, us] = await Promise.all([
          fetch(query + '&country=cn').then((r) => (r.ok ? r.json() : { results: [] })).catch(() => ({ results: [] })),
          fetch(query + '&country=us').then((r) => (r.ok ? r.json() : { results: [] })).catch(() => ({ results: [] })),
        ]);
        if (!active) return;
        const seen = new Set<string>();
        const merged: OnlineIcon[] = [];
        for (const app of [...(cn.results || []), ...(us.results || [])]) {
          const name = String(app.trackName || '').trim();
          if (!name || !app.artworkUrl100) continue;
          const dedupeKey = name.toLowerCase();
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          // 100x100 模板换成 200x200 拿更清晰的图
          merged.push({ name, url: String(app.artworkUrl100).replace('100x100bb', '200x200bb') });
          if (merged.length >= 16) break;
        }
        setOnlineIcons(merged);
      } finally {
        if (active) setOnlineLoading(false);
      }
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [keyword]);

  useEffect(() => {
    return () => {
      folderFiles.forEach((item) => URL.revokeObjectURL(item.preview));
    };
  }, [folderFiles]);

  const isImageFile = (file: File) => {
    if (file.type.startsWith('image/')) return true;
    return /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name);
  };

  const handleUploadFile = async (file: File) => {
    try {
      setUploading(true);
      setUploadError(null);
      const url = await api.uploadSubscriptionIcon(file);
      if (!url) {
        throw new Error('Upload response missing URL');
      }
      onSelect(url);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handlePhotoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!isImageFile(file)) {
      setUploadError('Please choose an image file.');
      return;
    }
    await handleUploadFile(file);
  };

  const handleFolderPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';

    const imageFiles = files.filter(isImageFile).slice(0, 36);
    if (imageFiles.length === 0) {
      setUploadError('No image files found in that folder.');
      setFolderFiles([]);
      return;
    }

    setUploadError(null);
    setFolderFiles((prev) => {
      prev.forEach((item) => URL.revokeObjectURL(item.preview));
      return imageFiles.map((file) => ({
        file,
        name: file.name,
        preview: URL.createObjectURL(file),
      }));
    });
  };

  const renderIconGrid = (items: Array<{ name: string; icon: string }>) => (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-4">
      {items.map((service) => (
        <button
          key={service.name}
          onClick={() => onSelect(service.icon)}
          className="flex flex-col items-center gap-3 p-4 bg-surface-container-lowest rounded-xl hover:bg-surface-container-low transition-all group border border-outline-variant/10"
        >
          <div className="w-16 h-16 rounded-xl overflow-hidden shadow-sm group-active:scale-90 transition-transform flex items-center justify-center bg-white">
            <img
              className="w-full h-full object-cover"
              src={resolveAssetUrl(service.icon)}
              alt={service.name}
              referrerPolicy="no-referrer"
              loading="lazy"
            />
          </div>
          <span className="text-[13px] font-semibold text-on-surface truncate w-full text-center">{service.name}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-surface">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { void handlePhotoPick(e); }}
      />
      <input
        ref={folderInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFolderPick}
        {...({ webkitdirectory: '', directory: '' } as any)}
      />

      <div className="mb-8">
        <h2 className="font-manrope text-2xl font-extrabold text-on-surface mb-2">Select Icon</h2>
        <p className="text-on-surface-variant text-sm font-medium">Search the app store or upload your own.</p>
      </div>

      <div className="relative mb-6 group">
        <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
          <Search className="text-on-surface-variant/60" size={20} />
        </div>
        <input
          className="w-full h-14 pl-12 pr-4 bg-surface-container-low border-none rounded-xl font-inter text-on-surface placeholder:text-on-surface-variant/60 focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-lowest transition-all"
          placeholder="搜索应用，如 微信 / Netflix..." 
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {onlineLoading && (
        <p className="flex items-center gap-2 text-xs text-on-surface-variant mb-4 px-1">
          <Loader2 size={14} className="animate-spin" /> 正在搜索应用商店...
        </p>
      )}
      {onlineIcons && onlineIcons.length > 0 && (
        <div className="mb-8">
          <h3 className="font-manrope text-xs font-bold uppercase tracking-widest text-on-surface-variant/70 mb-3 flex items-center gap-1">
            <Globe size={12} /> App Store 结果
          </h3>
          {renderIconGrid(onlineIcons.map((item) => ({ name: item.name, icon: item.url })))}
        </div>
      )}
      {onlineIcons && !onlineLoading && onlineIcons.length === 0 && keyword && (
        <p className="text-xs text-on-surface-variant mb-6 px-1">
          应用商店没有找到「{keyword}」，可以直接上传图片作为图标。
        </p>
      )}

      {filtered.length > 0 && (
        <div className="mb-6">
          <h3 className="font-manrope text-xs font-bold uppercase tracking-widest text-on-surface-variant/70 mb-3">Popular Services</h3>
          {renderIconGrid(filtered)}
        </div>
      )}

      <div className="mt-auto space-y-4 pt-6">
        <h3 className="font-manrope text-xs font-bold uppercase tracking-widest text-on-surface-variant/70 mb-2">Can't find it?</h3>
        {uploadError && (
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-600">
            {uploadError}
          </div>
        )}

        {folderFiles.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-on-surface-variant">Images from folder</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {folderFiles.map((item) => (
                <button
                  key={`${item.name}-${item.preview}`}
                  onClick={() => { void handleUploadFile(item.file); }}
                  className="bg-surface-container-lowest rounded-xl p-2 border border-outline-variant/10 hover:bg-surface-container-low transition-colors"
                >
                  <img
                    src={item.preview}
                    alt={item.name}
                    className="w-full aspect-square object-cover rounded-lg"
                  />
                  <p className="text-[10px] mt-1 truncate text-on-surface-variant">{item.name}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-4 p-4 bg-surface-container-low rounded-xl hover:bg-surface-container hover:shadow-sm transition-all group disabled:opacity-70"
          >
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              {uploading ? <Loader2 className="animate-spin" size={22} /> : <ImagePlus size={22} />}
            </div>
            <div className="text-left">
              <p className="font-bold text-on-surface">Upload from photos/files</p>
              <p className="text-xs text-on-surface-variant">Pick an image from your local album or files</p>
            </div>
            <ChevronRight className="ml-auto text-on-surface-variant/40" size={20} />
          </button>

          <button
            onClick={() => folderInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-4 p-4 bg-surface-container-low rounded-xl hover:bg-surface-container hover:shadow-sm transition-all group disabled:opacity-70"
          >
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <FolderOpen size={22} />
            </div>
            <div className="text-left">
              <p className="font-bold text-on-surface">Upload from folder</p>
              <p className="text-xs text-on-surface-variant">Choose a folder and select an image from it</p>
            </div>
            <ChevronRight className="ml-auto text-on-surface-variant/40" size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
