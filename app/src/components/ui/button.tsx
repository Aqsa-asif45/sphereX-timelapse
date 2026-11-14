import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const button = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-ctl text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
  {
    variants: {
      variant: {
        primary: 'bg-time text-bg hover:bg-[#ffc76e]',
        outline: 'border border-ctl bg-transparent text-ink hover:bg-hover',
        ghost: 'text-ink-2 hover:bg-hover hover:text-ink',
        selected: 'border border-focus bg-raised text-ink',
      },
      size: { sm: 'h-8 px-3', md: 'h-10 px-4', icon: 'h-9 w-9' },
    },
    defaultVariants: { variant: 'outline', size: 'md' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> { asChild?: boolean }

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...props }, ref) => {
  const C = asChild ? Slot : 'button';
  return <C ref={ref} className={cn(button({ variant, size }), className)} {...props} />;
});
Button.displayName = 'Button';
