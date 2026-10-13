// Generated template data. Update with npm run update:presets.
export default {
  source: {
    repository: 'Aethersailor/Custom_OpenClash_Rules',
    branch: 'main',
    catalog: {
      repository: 'vernesong/OpenClash',
      commit: 'bafc411c72d5a63428955ba3b434cd68ffb715f7',
      path: 'luci-app-openclash/root/usr/share/openclash/res/sub_ini.list',
    },
  },
  templates: [
    {
      id: 'Custom_Clash.ini',
      text: '标准版 Custom_Clash',
      value:
        'https://raw.githubusercontent.com/Aethersailor/Custom_OpenClash_Rules/refs/heads/main/cfg/Custom_Clash.ini',
      group: 'Aethersailor',
      profiles: ['extended'],
      targets: ['clash', 'clashr'],
    },
    {
      id: 'Custom_Clash_Fallback.ini',
      text: '标准版 故障转移',
      value:
        'https://raw.githubusercontent.com/Aethersailor/Custom_OpenClash_Rules/refs/heads/main/cfg/Custom_Clash_Fallback.ini',
      group: 'Aethersailor',
      profiles: ['extended'],
      targets: ['clash', 'clashr'],
    },
    {
      id: 'Custom_Clash_Lite.ini',
      text: '轻量版 Custom_Clash_Lite',
      value:
        'https://raw.githubusercontent.com/Aethersailor/Custom_OpenClash_Rules/refs/heads/main/cfg/Custom_Clash_Lite.ini',
      group: 'Aethersailor',
      profiles: ['extended'],
      targets: ['clash', 'clashr'],
    },
    {
      id: 'Custom_Clash_Lite_Fallback.ini',
      text: '轻量版 故障转移',
      value:
        'https://raw.githubusercontent.com/Aethersailor/Custom_OpenClash_Rules/refs/heads/main/cfg/Custom_Clash_Lite_Fallback.ini',
      group: 'Aethersailor',
      profiles: ['extended'],
      targets: ['clash', 'clashr'],
    },
    {
      id: 'Custom_Clash_GFW.ini',
      text: '极简版(GFW) Custom_Clash_GFW',
      value:
        'https://raw.githubusercontent.com/Aethersailor/Custom_OpenClash_Rules/refs/heads/main/cfg/Custom_Clash_GFW.ini',
      group: 'Aethersailor',
      profiles: ['extended'],
      targets: ['clash', 'clashr'],
    },
    {
      id: 'Custom_Clash_GFW_Fallback.ini',
      text: '极简版(GFW) 故障转移',
      value:
        'https://raw.githubusercontent.com/Aethersailor/Custom_OpenClash_Rules/refs/heads/main/cfg/Custom_Clash_GFW_Fallback.ini',
      group: 'Aethersailor',
      profiles: ['extended'],
      targets: ['clash', 'clashr'],
    },
    {
      id: 'Custom_Clash_Full.ini',
      text: '重度分流版 Custom_Clash_Full',
      value:
        'https://raw.githubusercontent.com/Aethersailor/Custom_OpenClash_Rules/refs/heads/main/cfg/Custom_Clash_Full.ini',
      group: 'Aethersailor',
      profiles: ['extended'],
      targets: ['clash', 'clashr'],
    },
    {
      id: 'Custom_Clash_Full_Fallback.ini',
      text: '重度分流版 故障转移',
      value:
        'https://raw.githubusercontent.com/Aethersailor/Custom_OpenClash_Rules/refs/heads/main/cfg/Custom_Clash_Full_Fallback.ini',
      group: 'Aethersailor',
      profiles: ['extended'],
      targets: ['clash', 'clashr'],
    },
  ],
};
