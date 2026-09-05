import React, { useEffect, useRef, useState } from 'react';
import { Search, ChevronRight, ImagePlus, FolderOpen, Loader2 } from 'lucide-react';
import { api } from '../lib/api';

interface IconSelectionProps {
  onSelect: (icon: string) => void;
  onBack: () => void;
}

const SERVICES = [
  { name: 'Netflix', color: '#E50914', icon: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAL82hkzGGIwGmjYpDIu8QAZ_Uo-qqfPvACald0AI4wwuD0ESmpiBtTgr_Zw5oN-xOuBKt2ffh8RAFH9yKl9APVNOYFeegWzDnbIWOmFpXL1-rPAoKvI8Rq-qjWiNSfWqkdMkquEEeaw6uvX6HiJ0K2fAcWO672kcBwzI6PKiZSqr8KjjOyuqR2G4zFJIyJrY3cWGczejk5c4HVwhsg-zsTbBsHkDGauWbA0kfB0vGwSSgG_eOZl7rbaFctSdCDnJrAJKikBPm1ISJV' },
  { name: 'Spotify', color: '#1DB954', icon: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBb5-h24tic4yU7knHIY_D6EXuQ0AH-xpc1p5xkN3H5_52vXnb7L43dkwqVdwweRcVe-we5eH8nR5QB0Q5iqscc-INw_Ku48cxlCNUlGRa2zWZu15XmNlZtOD5BNQkiRmayv92CZyxciHn-2nejjFUztamhns2SB-bOm2Z87ym-XM6HIDZw5ojbbzH5xGO6oJuQ1w4yYr5ylkU9w0nyxRohe7_nEXMjK175flgCNdSgPbntnyU_TXflnA06j-efSZ_vRdKzEb1zW9FJ' },
  { name: 'Disney+', color: '#001E3D', icon: 'https://lh3.googleusercontent.com/aida-public/AB6AXuB6wGT8typnJSfEhquTn7rBZEzk98CNTh6-ycfxKQg3YBkeY4EQoeJNPCxmvHdWeEwfDF8Y8R1q9wp4DM6YdNzAjq1a223Z6Gr233zs5u7l4kNrt1LWChgAi1mmvOCzAlO3_j_6qUKg4rcLgtclgwdz6aY3YkgqltjucGieONHjmkqZziB0-aJ6oVMMCi_Jvc-OtU9o2QcpTy3cNlPcd7_vFjKxbthrIXGiaZC17Gt692bPT7JPHBKjyvU_B7cTtDqnjCabgQd3u32u' },
  { name: 'YouTube', color: '#FFFFFF', icon: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDOs36mLCorRJHDm4m7YKbCo0_UXpVaq9tccn35X8G2Lwp3aOKuaJ1MjlznyOldMxkRFQpdPqV_RvhaM-2leu8vLUVb7T0yEozn6R4ERHxUNBO2WUVHEtU4VAcLhb-OT6OSQKypL-l3gAsxtZDEpyCZWPm2DNqN8gDIezhvVcpIs-vFjkV_HrZWUnsoN8IDb3hWwCQA8wDgqRl648yX0xzlw1jATP2EGY6pRM38R3OSfLxhEQRHHcIL5-NUSVqHOgu9EqJ3f1ZON09F' },
  { name: 'Apple Music', color: '#FA243C', icon: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBsk2cRP9shqTHrAee_ZQrgNrp60jDi2eVB4cTg32-IEZC34QpNFC5CkOZh9RF1nRxg9ylrzsm8w9InF9wVE9tDDICYFYvZd8nyQjp1gig7Dkda2_XnjSKUgTpPGGZR2OhKO5vawoeedwrZiQJMVjiDCNC9AXxbfRRayidKj4OCE5CgrsIgPYoHhaqFOEx6COF0RuIx8mMa4Llog64BPDXuth9jlwsBSwz6KQ-PNRl8wZGpMLz01fgsrSl6lZNEMpzU9jz4kHOuGpqt' },
  { name: 'HBO Max', color: '#5822B4', icon: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAOqrAtXS-Udn-eBmyFPKCHQrF110lnT8SOlyGgzu2_qeeH5RKtcXLyf-3aIedjFffDQRfokFLjIrXX_JOUMchE-qAiSuTvha_mIBNftR3fD_WYbJQRZ8Eb7170uQv37rqOXU5Qhp2uEuVCqCl06sKNnphC6wNH2HbQnQMmkueAzXmLtoAsdnQXa89O0FjFOh5KhbRGyL6xLhboLvTWu_VWXdyoKjAU6xDGqKg4xxrmUy9kJeZGId2EZ1rPJMByfZEn0xrDMx_zoGoQ' },
  { name: 'Prime Video', color: '#00A8E1', icon: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCAv-B4qEl1b6NHUgycFdM8orcMdWnXnFXuSltJmQMrNsqIsG7T1B-pKcwTIZ9E6JiL2OsEFbSl84YjXThxh3hmkwgcQpYMOXwm_Cn_O9g3qiS91FG1C2V8TSRL8djV4KhOdfGM_3sNcThVE3-O10vKdc5lu4E_lxMI6QditvFuNu2eA_vCTV3SlL48dHlXw4h5LG8HRlzbO_ObUxac3i5agGKB5HRmS0BTlnGxPpy6-deY8Y3lng7HZCfIpWW7aHJ8e8lVOgcHzfL7' },
  { name: 'Slack', color: '#FFFFFF', icon: 'https://lh3.googleusercontent.com/aida-public/AB6AXuB745lxCI4sLw7kb7bvgK54wrCp44I7Ext7yEhCqQ3atuEb5nVSPZi1AoxsB2LfF8jp6xYrKYrMpfCvmDVxTVKmDrR1VOGm5bqpsUlaEHtOofJTvNnCPuS0ICS8tOyWJoAaQsZZJZQvZFBNWV_feJHb0fwGLTS207oaG7J_NbAdT2aX-BNRHAfFSOCTwq4ab_5mDt0ijvlVlq3vlHeNMth-vsBM7GRJ3a_mVXop_NP9WbIuhh22VvXuhv6Di743T-sdfjDGK58f9jsc' },
  { name: 'Canva', color: '#00C4CC', icon: 'https://lh3.googleusercontent.com/aida-public/AB6AXuB4-sr_PnT1bzKxErNtHOJWiCIoEA8nM09xB0It3-SlD55L8uqxF07UG-YkUkmxrGZxRvjMTrtz65CudetwIstbk5B6vx2iydzGzParLJYXweXZ2F923jv8C09zfoO_MauD_hjAt3KkDgvBXyBmsoKHAWdtM-Q0ajxEW0NQgITE_3b3OiecPFrIsHiYMO0x3XbFacNviGW7cIXpU2A1qRyxzCVy4GQI1OefqJcV9CWOqW4MhOMOHCNoP3gsnQQBa9sIWpI1pfQ4TrsV' },
  { name: 'Notion', color: '#FFFFFF', icon: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAWFcNl6zS_1nVALoHukTsV4IW9ABoEAn-Q_NrVZ6O3OLKrFYfHmz60hOfVBJDmIlcz8aDsDvdZp7Ic4WEPS_1CecXKITI2SUB7rhN0LjH0FNhfgDTZ7DlyGh6kBgxqn0t33LP3R6g_YPDzpS195ZoWCyc_M4f_7Rlj8rGJiQgELgGYJYlnvKEDiX6SQBrtzpyiSlBJUIEMEiRJbrSrworV1NcYcqp-uQiSqzUcmcbLMUdqjNVAD-PFUf9RvPrzLurjb0gncZuDGKf9' },
  { name: 'ChatGPT', color: '#74AA9C', icon: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDKwVLtTvyD7SxUdUIv7xmRJEEU8QhxfTuS37jjy0D7AZcyc8rZWIqHg5PjVRIXSbQKxAUShjfQJUhwaKKasVbSNIdXaIf8aENSwJezeSAbPpenvG7UX5tOu6IiItkFuUIDLmbBXQ8i5wzQXJk9mVi0Rm0EYinkD2yZDqKpnL-w6W418P23On6cjeUQuVTcg3oloxbbhFfKRBre6oCwyCb2H3djUvE1kHuNanuAL7iT-VRc9x-zYAQJqcw029Pa9HG_jjD2YzyFmOnU' },
  { name: 'Discord', color: '#5865F2', icon: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAXq7ARIzGDpbZlmRuutdaFME-fPlZCIgWwJi0KKVnnCmDgOMlnZWzu3OvZmfH63p_Vsnu9mM5AR7Vb3lAzqh19zaF4_Qx1_UMHG-2lEPdwC1__g8S9drUPiZrTeLfCO71sfSs7_occrvie_vEfoPs3KUUdC0D_f3ErGhou1_x-q9s0owpxWnGjldN6sGa0NSLGaiJonOSxofv9ve3Zp-xDHKd3jOiT4GTvWTNC-n7A1UFABmaAEoj-19h9Kkxg_R6t2k_ak02N9HLS' },
];

export default function IconSelection({ onSelect, onBack }: IconSelectionProps) {
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [folderFiles, setFolderFiles] = useState<Array<{ file: File; name: string; preview: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const filtered = SERVICES.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));

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
        <p className="text-on-surface-variant text-sm font-medium">Choose a service from our library or upload your own.</p>
      </div>

      <div className="relative mb-8 group">
        <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
          <Search className="text-on-surface-variant/60" size={20} />
        </div>
        <input 
          className="w-full h-14 pl-12 pr-4 bg-surface-container-low border-none rounded-xl font-inter text-on-surface placeholder:text-on-surface-variant/60 focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-lowest transition-all" 
          placeholder="Search for services..." 
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="mb-6">
        <h3 className="font-manrope text-xs font-bold uppercase tracking-widest text-on-surface-variant/70">Popular Services</h3>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 gap-4">
        {filtered.map((service) => (
          <button 
            key={service.name}
            onClick={() => onSelect(service.icon)}
            className="flex flex-col items-center gap-3 p-4 bg-surface-container-lowest rounded-xl hover:bg-surface-container-low transition-all group border border-outline-variant/10"
          >
            <div 
              className="w-16 h-16 rounded-xl overflow-hidden shadow-sm group-active:scale-90 transition-transform flex items-center justify-center"
              style={{ backgroundColor: service.color }}
            >
              <img className="w-10 h-10 object-contain" src={service.icon} alt={service.name} referrerPolicy="no-referrer" />
            </div>
            <span className="text-[13px] font-semibold text-on-surface">{service.name}</span>
          </button>
        ))}
      </div>

      <div className="mt-12 space-y-4">
        <h3 className="font-manrope text-xs font-bold uppercase tracking-widest text-on-surface-variant/70 mb-4">Can't find it?</h3>
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
