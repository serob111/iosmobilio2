import { PhoneMockup } from "@/components/ui/PhoneMockup";

const BASE_SHADOW = "0 30px 70px rgba(10,5,40,0.45)";
const LIT_SHADOW = "0 0 0 4px #D7FF4F, 0 30px 80px rgba(215,255,79,0.35)";
const CENTER_SHADOW = "0 40px 90px rgba(10,5,40,0.55)";

/** The restaurant app screen shown inside the left-hand phone. */
function CasaRomaScreen() {
  return (
    <div className="flex h-full flex-col bg-[#FFF6EC] text-[#2B1A0E]">
      <div className="px-4 pb-2.5 pt-[46px] text-[22px] font-bold tracking-tight">Casa Roma</div>
      <div className="mx-4 flex h-[120px] items-end rounded-[18px] bg-[#E8794A] p-3.5 text-[17px] font-bold text-white">
        Order for tonight
      </div>
      <div className="mx-4 mt-3 flex flex-col gap-2 text-[13px]">
        <div className="flex justify-between rounded-xl bg-white px-3 py-2.5">
          <span className="font-semibold">Margherita</span>
          <span>$14</span>
        </div>
        <div className="flex justify-between rounded-xl bg-white px-3 py-2.5">
          <span className="font-semibold">Carbonara</span>
          <span>$17</span>
        </div>
      </div>
    </div>
  );
}

/** The fitness-studio app screen shown inside the right-hand phone. */
function PulseStudioScreen() {
  return (
    <div className="flex h-full flex-col bg-[#111312] text-white">
      <div className="px-4 pb-2.5 pt-[46px] text-[22px] font-bold tracking-tight">Pulse Studio</div>
      <div className="mx-4 flex flex-col gap-1 rounded-[18px] bg-[#C6F24E] p-4 text-[#111312]">
        <span className="text-xs font-semibold">Next class</span>
        <span className="text-[19px] font-bold">HIIT · 18:30</span>
      </div>
      <div className="mx-4 mt-3 grid grid-cols-2 gap-2">
        <div className="h-[84px] rounded-2xl bg-[#1F2321]" />
        <div className="h-[84px] rounded-2xl bg-[#1F2321]" />
      </div>
    </div>
  );
}

/** The storefront app screen shown inside the center (front-most) phone. */
function LumenScreen() {
  return (
    <div className="flex h-full flex-col bg-white text-ink">
      <div className="flex items-center justify-between px-[18px] pb-2.5 pt-[50px]">
        <span className="text-2xl font-bold tracking-tight">Lumen</span>
        <span className="rounded-pill bg-[#F1EDFF] px-2.5 py-1 text-xs font-semibold text-violet">Bag · 2</span>
      </div>
      <div className="mx-[18px] flex h-[150px] items-end rounded-[20px] bg-lilac p-4 text-xl font-bold text-[#2A1A7A]">
        Lamps that
        <br />
        glow softer
      </div>
      <div className="mx-[18px] mt-3 grid grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-1">
          <div className="h-24 rounded-2xl bg-[#F4EFE6]" />
          <span className="text-xs font-semibold">Arc lamp</span>
          <span className="text-xs text-slate">$129</span>
        </div>
        <div className="flex flex-col gap-1">
          <div className="h-24 rounded-2xl bg-[#E6EEF4]" />
          <span className="text-xs font-semibold">Desk light</span>
          <span className="text-xs text-slate">$89</span>
        </div>
      </div>
    </div>
  );
}

/** The floating three-phone collage from the landing hero — desktop size/positions, clipped by the hero's own overflow-hidden so it never causes horizontal scroll. */
export function HeroPhonesDesktop({ pushLabel, noMacLabel }: { pushLabel: string; noMacLabel: string }) {
  return (
    <div className="relative mx-auto hidden h-[640px] max-w-[1440px] lg:block" aria-hidden="true">
      <div className="absolute left-[330px] top-[130px] -rotate-[8deg]">
        <PhoneMockup width={270} height={556} screenBackground="#FFF6EC" shadow={BASE_SHADOW} float>
          <CasaRomaScreen />
        </PhoneMockup>
      </div>
      <div className="absolute left-[840px] top-[130px] rotate-[8deg]">
        <PhoneMockup width={270} height={556} screenBackground="#111312" shadow={LIT_SHADOW} float>
          <PulseStudioScreen />
        </PhoneMockup>
      </div>
      <div className="absolute left-[580px] top-[80px] z-[2]">
        <PhoneMockup width={290} height={596} screenBackground="#FFFFFF" shadow={CENTER_SHADOW} float>
          <LumenScreen />
        </PhoneMockup>
      </div>
      <div className="absolute left-[1120px] top-[40px] z-[3] rotate-[6deg] rounded-pill bg-lime px-4 py-2.5 text-sm font-bold text-ink">
        {pushLabel}
      </div>
      <div className="absolute left-[150px] top-[80px] z-[3] -rotate-[6deg] rounded-pill bg-white px-4 py-2.5 text-sm font-bold text-ink">
        {noMacLabel}
      </div>
    </div>
  );
}

/** The same collage, repositioned/scaled for the mobile hero. */
export function HeroPhonesMobile({ pushLabel, noMacLabel }: { pushLabel: string; noMacLabel: string }) {
  return (
    <div className="relative h-[440px] w-full lg:hidden" aria-hidden="true">
      <div className="absolute left-[-46px] top-[160px] -rotate-[10deg]">
        <PhoneMockup width={170} height={350} screenBackground="#FFF6EC" shadow={BASE_SHADOW} float>
          <div className="flex h-full flex-col bg-[#FFF6EC] text-[#2B1A0E]">
            <div className="px-2.5 pb-1.5 pt-[30px] text-sm font-bold">Casa Roma</div>
            <div className="mx-2.5 flex h-[76px] items-end rounded-xl bg-[#E8794A] p-2 text-[11px] font-bold text-white">
              Order for tonight
            </div>
          </div>
        </PhoneMockup>
      </div>
      <div className="absolute left-[266px] top-[160px] rotate-[10deg]">
        <PhoneMockup width={170} height={350} screenBackground="#111312" shadow={LIT_SHADOW} float>
          <div className="flex h-full flex-col bg-[#111312] text-white">
            <div className="px-2.5 pb-1.5 pt-[30px] text-sm font-bold">Pulse Studio</div>
            <div className="mx-2.5 flex flex-col gap-0.5 rounded-xl bg-[#C6F24E] p-2.5 text-[#111312]">
              <span className="text-[9px] font-semibold">Next class</span>
              <span className="text-xs font-bold">HIIT · 18:30</span>
            </div>
          </div>
        </PhoneMockup>
      </div>
      <div className="absolute left-[90px] top-[120px] z-[2]">
        <PhoneMockup width={210} height={432} screenBackground="#FFFFFF" shadow={CENTER_SHADOW} float>
          <LumenScreen />
        </PhoneMockup>
      </div>
      <div className="absolute left-[230px] top-[90px] z-[3] rotate-[6deg] rounded-pill bg-lime px-3 py-2 text-xs font-bold text-ink">
        {pushLabel}
      </div>
      <div className="absolute left-4 top-[100px] z-[3] -rotate-[6deg] rounded-pill bg-white px-3 py-2 text-xs font-bold text-ink">
        {noMacLabel}
      </div>
    </div>
  );
}
